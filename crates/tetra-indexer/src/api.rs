//! The HTTP surface. Every body is built by [`crate::snapshot`]; a handler's
//! only jobs are choosing which cached body to send and how to frame it.

use crate::state::{AppState, GzBody};
use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, Path, Query, Request, State};
use axum::http::header::{
    ACCEPT_ENCODING, CACHE_CONTROL, CONTENT_ENCODING, CONTENT_TYPE, ETAG, IF_NONE_MATCH,
    RETRY_AFTER, VARY,
};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use tetra_index::{paths, ModEntry, ServerDetail, ServerEntry, FORMAT_VERSION};
use tetra_registry::{ExportRow, ServerKey};

/// Snapshot bodies change at most every 30 s, so a client that polls faster
/// than that is told to wait rather than re-download.
const SNAPSHOT_MAX_AGE: &str = "public, max-age=30";

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route(paths::HEALTH, get(health))
        .route(paths::SNAPSHOT, get(snapshot))
        .route(paths::DELTA, get(delta))
        .route(&format!("{}{{addr}}", paths::SERVER), get(server))
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

async fn delta(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let Some(bodies) = state.bodies() else {
        return not_ready();
    };
    // A missing or unparseable `since` is not an error: the client gets the
    // whole list, which carries `partial: false` so it knows what it got.
    // The delta is only valid from the generation that built it — a client
    // asking from an older cursor gets the whole list, not a partial answer
    // that would look complete while missing servers.
    let since = params.get("since").and_then(|s| s.parse::<i64>().ok());
    let body = match (since, bodies.delta.as_ref()) {
        (Some(since), Some(delta)) if since == bodies.delta_from => delta,
        _ => &bodies.snapshot,
    };
    serve(body, &headers).await
}

async fn server(State(state): State<Arc<AppState>>, Path(addr): Path<String>) -> Response {
    let Ok(sock) = addr.parse::<SocketAddrV4>() else {
        return (StatusCode::BAD_REQUEST, "expected ip:query_port").into_response();
    };
    let key = ServerKey {
        ip: *sock.ip(),
        query_port: sock.port(),
    };
    let registry = Arc::clone(&state.registry);
    let looked_up = tokio::task::spawn_blocking(move || {
        let reader = registry.reader()?;
        let Some(row) = reader.export_one(key)? else {
            return Ok::<_, tetra_registry::RegistryError>(None);
        };
        let mods = reader.mods_for(key)?;
        Ok(Some((row, mods)))
    })
    .await;

    match looked_up {
        Ok(Ok(Some((row, mods)))) => Json(ServerDetail {
            format_version: FORMAT_VERSION,
            server: entry(row),
            mods: mods
                .into_iter()
                .map(|m| ModEntry {
                    workshop_id: m.workshop_id,
                    name: m.name,
                })
                .collect(),
        })
        .into_response(),
        Ok(Ok(None)) => (StatusCode::NOT_FOUND, "unknown address").into_response(),
        Ok(Err(e)) => {
            tracing::warn!(error = %e, "detail lookup failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "lookup failed").into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "detail task failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "lookup failed").into_response()
        }
    }
}

fn entry(row: ExportRow) -> ServerEntry {
    ServerEntry {
        addr: format!("{}:{}", row.key.ip, row.key.query_port),
        game_port: row.game_port,
        name: row.name,
        map: row.map,
        players: row.players,
        max_players: row.max_players,
        bots: row.bots,
        locked: row.locked,
        vac: row.vac,
        version: row.version,
        keywords: row.keywords,
        description: row.description,
        mod_ids: row.mod_ids,
        last_responded: row.last_responded,
    }
}

fn not_ready() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "no snapshot has been built yet",
    )
        .into_response()
}

/// Send a pre-built body: 304 when the client already has it, gzip when it
/// will take gzip, and a one-off decompression when it won't.
async fn serve(body: &GzBody, headers: &HeaderMap) -> Response {
    if let Some(inm) = headers.get(IF_NONE_MATCH).and_then(|v| v.to_str().ok()) {
        if etag_matches(inm, &body.etag) {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(ETAG, body.etag.clone())
                .header(CACHE_CONTROL, SNAPSHOT_MAX_AGE)
                .header(VARY, "accept-encoding")
                .body(Body::empty())
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    }

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "application/json")
        .header(ETAG, body.etag.clone())
        .header(CACHE_CONTROL, SNAPSHOT_MAX_AGE)
        .header(VARY, "accept-encoding");

    let bytes = if accepts_gzip(headers) {
        builder = builder.header(CONTENT_ENCODING, "gzip");
        body.bytes.clone()
    } else {
        // Rare: reqwest always asks for gzip. Expanded per request rather
        // than kept hot, so the plain copy never costs steady-state memory.
        let compressed = body.bytes.clone();
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

/// Strong comparison against every tag the client offered. Deliberately not
/// honouring `*` or weak tags: the only correct 304 here is "you already have
/// exactly these bytes".
fn etag_matches(if_none_match: &str, etag: &str) -> bool {
    if_none_match
        .split(',')
        .map(str::trim)
        .any(|candidate| candidate == etag)
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
    fn a_304_needs_the_exact_tag() {
        assert!(etag_matches("\"abc\"", "\"abc\""));
        // Offered among others, as a client holding two generations would.
        assert!(etag_matches("\"old\", \"abc\"", "\"abc\""));
        assert!(!etag_matches("\"abc\"", "\"abd\""));
        // Unquoted, weak, wildcard and empty are all not this body.
        assert!(!etag_matches("abc", "\"abc\""));
        assert!(!etag_matches("W/\"abc\"", "\"abc\""));
        assert!(!etag_matches("*", "\"abc\""));
        assert!(!etag_matches("", "\"abc\""));
    }

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
        let body = GzBody {
            bytes: Bytes::from_static(b"x"),
            etag: "\"e\"".to_string(),
        };
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT_ENCODING, "gzip".parse().unwrap());

        let ok = serve(&body, &headers).await;
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.headers().get(VARY).unwrap(), "accept-encoding");

        headers.insert(IF_NONE_MATCH, "\"e\"".parse().unwrap());
        let not_modified = serve(&body, &headers).await;
        assert_eq!(not_modified.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(not_modified.headers().get(VARY).unwrap(), "accept-encoding");
    }

    async fn body_of(response: Response) -> String {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    async fn delta_response(state: &Arc<AppState>, since: Option<&str>) -> Response {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT_ENCODING, "gzip".parse().unwrap());
        let params = since
            .map(|s| HashMap::from([("since".to_string(), s.to_string())]))
            .unwrap_or_default();
        delta(State(Arc::clone(state)), Query(params), headers).await
    }

    #[tokio::test]
    async fn a_delta_is_served_only_from_its_own_cursor() {
        let registry = Arc::new(tetra_registry::Registry::open_in_memory().unwrap());
        let state = Arc::new(AppState::new(registry, 60));
        let body = |bytes: &'static [u8], etag: &str| GzBody {
            bytes: Bytes::from_static(bytes),
            etag: etag.to_string(),
        };
        state.publish(Arc::new(crate::state::Bodies {
            generated_at: 1,
            generation: 7,
            snapshot: body(b"full", "\"full\""),
            delta: Some(body(b"partial", "\"partial\"")),
            delta_from: 6,
            keys: std::collections::HashSet::new(),
            fingerprints: HashMap::new(),
            servers: 1,
            responsive: 1,
            with_mods: 0,
            populated: 0,
        }));

        assert_eq!(
            body_of(delta_response(&state, Some("6")).await).await,
            "partial"
        );
        for since in [Some("5"), Some("garbage"), None] {
            assert_eq!(
                body_of(delta_response(&state, since).await).await,
                "full",
                "since {since:?}"
            );
        }
    }

    #[test]
    fn the_route_table_is_not_self_conflicting() {
        // `/v1/servers/{addr}` is a sibling of two static paths under the
        // same prefix; a conflict here panics at startup, not on a request.
        let registry = Arc::new(tetra_registry::Registry::open_in_memory().unwrap());
        let _ = router(Arc::new(AppState::new(registry, 60)));
    }
}
