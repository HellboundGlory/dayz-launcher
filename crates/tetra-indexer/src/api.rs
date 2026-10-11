//! The HTTP surface. The snapshot body is built by [`crate::snapshot`]; a
//! handler only frames it.

use crate::state::AppState;
use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, Request, State};
use axum::http::header::{
    ACCEPT_ENCODING, CACHE_CONTROL, CONTENT_ENCODING, CONTENT_TYPE, RETRY_AFTER, VARY,
};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use tetra_index::paths;

/// Snapshot bodies change at most every 30 s, so a client that polls faster
/// than that is told to wait rather than re-download.
const SNAPSHOT_MAX_AGE: &str = "public, max-age=30";

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route(paths::HEALTH, get(health))
        .route(paths::SNAPSHOT, get(snapshot))
        // Launchers up to 2.7.0 ask for a delta; they get the full list.
        .route(paths::DELTA, get(snapshot))
        .layer(axum::middleware::from_fn_with_state(
            Arc::clone(&state),
            rate_limit,
        ))
        .with_state(state)
}

/// Uncompressed on purpose: it is a few hundred bytes and every client polls
/// it before deciding whether to trust the index at all.
async fn health(State(state): State<Arc<AppState>>) -> Json<tetra_index::Health> {
    Json(state.health())
}

async fn snapshot(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let Some(bodies) = state.bodies() else {
        return not_ready();
    };
    serve(&bodies.snapshot, &headers).await
}

fn not_ready() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "no snapshot has been built yet",
    )
        .into_response()
}

/// Send a pre-built body: gzip when the client will take gzip, and a one-off
/// decompression when it won't.
async fn serve(body: &Bytes, headers: &HeaderMap) -> Response {
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "application/json")
        .header(CACHE_CONTROL, SNAPSHOT_MAX_AGE)
        .header(VARY, "accept-encoding");

    let bytes = if accepts_gzip(headers) {
        builder = builder.header(CONTENT_ENCODING, "gzip");
        body.clone()
    } else {
        // Rare: reqwest always asks for gzip. Expanded per request rather
        // than kept hot, so the plain copy never costs steady-state memory.
        let compressed = body.clone();
        match tokio::task::spawn_blocking(move || inflate(&compressed)).await {
            Ok(Ok(plain)) => Bytes::from(plain),
            Ok(Err(e)) => {
                tracing::warn!(error = %e, "decompressing cached body failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            Err(e) => {
                tracing::warn!(error = %e, "decompress task failed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    };

    builder
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn inflate(compressed: &[u8]) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut out = Vec::with_capacity(compressed.len() * 8);
    flate2::read::GzDecoder::new(compressed).read_to_end(&mut out)?;
    Ok(out)
}

fn accepts_gzip(headers: &HeaderMap) -> bool {
    headers
        .get(ACCEPT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.split(',').any(|entry| {
                let mut parts = entry.split(';');
                parts.next().is_some_and(|name| name.trim() == "gzip")
                    && !parts.any(|param| {
                        let (name, value) = param.split_once('=').unwrap_or((param, ""));
                        name.trim().eq_ignore_ascii_case("q")
                            && value.trim().parse::<f64>().is_ok_and(|q| q == 0.0)
                    })
            })
        })
}

/// Bucket key for the rate limiter. A local socket peer means a proxy is in
/// front, so the last `X-Forwarded-For` hop is the address it appended; the
/// client-supplied first hop is never trusted. Otherwise the peer is the
/// client.
fn client_key(peer: IpAddr, forwarded_for: Option<&str>) -> String {
    if is_local(peer) {
        if let Some(hop) = forwarded_for.and_then(|h| h.rsplit(',').next()) {
            if let Ok(ip) = hop.trim().parse::<IpAddr>() {
                return ip.to_string();
            }
        }
    }
    peer.to_string()
}

fn is_local(peer: IpAddr) -> bool {
    match peer.to_canonical() {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

async fn rate_limit(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let forwarded_for = request
        .headers()
        .get_all("x-forwarded-for")
        .iter()
        .next_back()
        .and_then(|v| v.to_str().ok());
    let client = client_key(peer.ip(), forwarded_for);

    match state.limiter.check(&client) {
        Ok(()) => next.run(request).await,
        Err(retry_after) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(RETRY_AFTER, retry_after.to_string())],
            "rate limit exceeded",
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gzip_is_only_sent_when_the_client_did_not_refuse_it() {
        let cases = [
            ("gzip", true),
            ("gzip, deflate, br", true),
            ("br;q=1, gzip;q=0.5", true),
            ("gzip;q=0", false),
            ("gzip ; q=0.0", false),
            ("identity", false),
            ("gzipper", false),
        ];
        for (value, expected) in cases {
            let mut headers = HeaderMap::new();
            headers.insert(ACCEPT_ENCODING, value.parse().unwrap());
            assert_eq!(accepts_gzip(&headers), expected, "value {value:?}");
        }
        assert!(!accepts_gzip(&HeaderMap::new()));
    }

    #[test]
    fn the_forwarded_for_key_uses_the_hop_the_proxy_appended() {
        let cases = [
            ("127.0.0.1", Some("1.2.3.4, 9.9.9.9"), "9.9.9.9"),
            ("10.1.2.3", Some("1.2.3.4"), "1.2.3.4"),
            ("172.17.0.1", Some("1.2.3.4, 5.6.7.8"), "5.6.7.8"),
            ("192.168.1.1", Some("5.6.7.8"), "5.6.7.8"),
            ("169.254.1.1", Some("5.6.7.8"), "5.6.7.8"),
            ("::1", Some("2001:db8::1"), "2001:db8::1"),
            ("fe80::1", Some("2001:db8::1"), "2001:db8::1"),
            ("fd00::1", Some("2001:db8::1"), "2001:db8::1"),
            ("::ffff:127.0.0.1", Some("1.2.3.4, 9.9.9.9"), "9.9.9.9"),
            ("::ffff:10.0.0.1", Some("5.6.7.8"), "5.6.7.8"),
            ("8.8.8.8", Some("1.2.3.4"), "8.8.8.8"),
            ("8.8.8.8", Some("1.2.3.4, 9.9.9.9"), "8.8.8.8"),
            ("8.8.8.8", None, "8.8.8.8"),
            ("127.0.0.1", None, "127.0.0.1"),
            ("127.0.0.1", Some("not-an-ip"), "127.0.0.1"),
            ("127.0.0.1", Some("1.2.3.4, garbage"), "127.0.0.1"),
            ("127.0.0.1", Some("   "), "127.0.0.1"),
            ("127.0.0.1", Some("2.2.2.2,"), "127.0.0.1"),
        ];
        for (peer, header, expected) in cases {
            assert_eq!(
                client_key(peer.parse().unwrap(), header),
                expected,
                "peer {peer}, header {header:?}"
            );
        }
    }

    #[tokio::test]
    async fn the_snapshot_response_varies_on_accept_encoding() {
        let body = Bytes::from_static(b"x");
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT_ENCODING, "gzip".parse().unwrap());

        let ok = serve(&body, &headers).await;
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.headers().get(VARY).unwrap(), "accept-encoding");
    }
}
