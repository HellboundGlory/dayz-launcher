//! HTTP client for a `tetra-indexer` backend.
//!
//! Every method is written on the assumption that the backend may be absent,
//! slow, or serving a schema this build doesn't know: those are ordinary
//! outcomes, not exceptions, because the launcher's own Steam pass is always
//! there to fall back to.

use crate::{paths, Health, Snapshot, FORMAT_VERSION};
use std::time::Duration;

/// Ceiling on a decompressed snapshot. The live index is ~270k addresses at
/// roughly 250 bytes of JSON each, so this leaves ~4x headroom while still
/// refusing to buffer an unbounded body into memory.
const MAX_SNAPSHOT_BYTES: usize = 256 * 1024 * 1024;

/// Cap for `health`. Its real body is a few KB, so this is generous while
/// still refusing a hostile origin.
const MAX_SMALL_BYTES: usize = 1024 * 1024;

/// Whole-request budget for the bulk snapshot. Generous: it is one large body
/// on a cold start, and giving up early just means a 17-minute Steam pass.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(180);

/// Whole-request budget for `health`, where a slow answer is worse
/// than no answer — the launcher is deciding whether to trust this backend.
const SMALL_TIMEOUT: Duration = Duration::from_secs(15);

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("index request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("index returned HTTP {0}")]
    Status(u16),
    #[error("index speaks format v{got}, this launcher reads v{want}")]
    Format { got: u32, want: u32 },
    #[error("index response exceeded the size cap")]
    TooLarge,
    #[error("index response was not valid JSON: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("invalid index url: {0}")]
    Url(String),
}

#[derive(Clone)]
pub struct IndexClient {
    http: reqwest::Client,
    base: String,
}

impl IndexClient {
    /// `base_url` is the origin, with or without a trailing slash.
    pub fn new(base_url: &str, user_agent: &str) -> Result<Self, IndexError> {
        let base = base_url.trim().trim_end_matches('/').to_string();
        if base.is_empty() {
            return Err(IndexError::Url("empty".into()));
        }
        if !base.starts_with("http://") && !base.starts_with("https://") {
            return Err(IndexError::Url(format!("{base} is not http(s)")));
        }
        let http = reqwest::Client::builder()
            .user_agent(user_agent.to_string())
            .connect_timeout(CONNECT_TIMEOUT)
            // The bodies are pre-gzipped on the server and served straight
            // from memory; asking for them uncompressed would waste ~5x the
            // bandwidth of the only request that matters.
            .gzip(true)
            .build()?;
        Ok(Self { http, base })
    }

    pub fn base_url(&self) -> &str {
        &self.base
    }

    /// The backend's health, and its clock when it replied (the `Date` header).
    pub async fn health(&self) -> Result<(Health, Option<i64>), IndexError> {
        let res = self
            .http
            .get(format!("{}{}", self.base, paths::HEALTH))
            // A cached reply would carry an old Date and skew the clock offset.
            .header(reqwest::header::CACHE_CONTROL, "no-cache")
            .timeout(SMALL_TIMEOUT)
            .send()
            .await?;
        let res = check_status(res)?;
        let backend_now = res
            .headers()
            .get(reqwest::header::DATE)
            .and_then(|v| v.to_str().ok())
            .and_then(parse_date);
        let cap = small_capacity(&res);
        let buf = read_capped(res, MAX_SMALL_BYTES, cap).await?;
        let health: Health = serde_json::from_slice(&buf)?;
        check_format(health.format_version)?;
        Ok((health, backend_now))
    }

    /// The whole list.
    pub async fn snapshot(&self) -> Result<Snapshot, IndexError> {
        let res = self
            .http
            .get(format!("{}{}", self.base, paths::SNAPSHOT))
            .timeout(SNAPSHOT_TIMEOUT)
            .send()
            .await?;
        let res = check_status(res)?;
        let buf = read_capped(res, MAX_SNAPSHOT_BYTES, 8 * 1024 * 1024).await?;
        let snapshot: Snapshot = serde_json::from_slice(&buf)?;
        check_format(snapshot.format_version)?;
        Ok(snapshot)
    }
}

fn parse_date(value: &str) -> Option<i64> {
    let at = httpdate::parse_http_date(value).ok()?;
    let secs = at.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    i64::try_from(secs).ok()
}

/// Read a body chunk by chunk, refusing it once past `max`. `bytes()` would
/// buffer the whole body first; `Content-Length` is the compressed size and
/// says nothing about what gzip expands to. `capacity` is a sizing hint for
/// the buffer, never a limit.
async fn read_capped(
    mut res: reqwest::Response,
    max: usize,
    capacity: usize,
) -> Result<Vec<u8>, IndexError> {
    let mut buf: Vec<u8> = Vec::with_capacity(capacity);
    while let Some(chunk) = res.chunk().await? {
        if buf.len() + chunk.len() > max {
            return Err(IndexError::TooLarge);
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// A `Content-Length` bounded by the response's own cap, for [`read_capped`]'s
/// sizing hint.
fn small_capacity(res: &reqwest::Response) -> usize {
    res.content_length()
        .unwrap_or(0)
        .min(MAX_SMALL_BYTES as u64) as usize
}

fn check_status(res: reqwest::Response) -> Result<reqwest::Response, IndexError> {
    if res.status().is_success() {
        Ok(res)
    } else {
        Err(IndexError::Status(res.status().as_u16()))
    }
}

/// A body in a format this build doesn't read is discarded, never migrated —
/// the whole index is regenerable from the network, so there is nothing to
/// preserve and a half-understood row would show wrong player counts.
fn check_format(got: u32) -> Result<(), IndexError> {
    if got == FORMAT_VERSION {
        Ok(())
    } else {
        Err(IndexError::Format {
            got,
            want: FORMAT_VERSION,
        })
    }
}

/// Health-probe backoff for a backend that is failing, so a client never
/// hammers a down origin. Same shape the Beans launcher uses.
pub const HEALTH_BACKOFF_SECS: &[u64] = &[5, 15, 30, 60, 120];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_date_header_reads_as_unix_seconds() {
        assert_eq!(
            parse_date("Sun, 18 Oct 2026 20:25:47 GMT"),
            Some(1_792_355_147)
        );
        assert_eq!(parse_date("not a date"), None);
    }

    #[test]
    fn a_base_url_must_be_http() {
        assert!(IndexClient::new("", "t").is_err(), "empty");
        assert!(
            IndexClient::new("index.example.com", "t").is_err(),
            "scheme"
        );
        let c = IndexClient::new("https://index.example.com/", "t").expect("valid");
        assert_eq!(
            c.base_url(),
            "https://index.example.com",
            "trailing slash is normalised away so paths don't double up"
        );
    }

    /// A hostile or broken origin must not make `health` buffer an unbounded
    /// body; it is refused once past the small cap.
    #[tokio::test]
    async fn health_refuses_a_body_over_the_small_cap() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("local addr");

        let body = vec![b'x'; 2 * 1024 * 1024];
        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().expect("accept");
            let mut req = [0u8; 1024];
            let _ = sock.read(&mut req);
            let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", body.len());
            let _ = sock.write_all(head.as_bytes());
            let _ = sock.write_all(&body);
        });

        let client = IndexClient::new(&format!("http://{addr}"), "test").expect("client");
        let err = client
            .health()
            .await
            .expect_err("a 2 MiB body exceeds the cap");
        assert!(matches!(err, IndexError::TooLarge));

        server.join().expect("server thread");
    }
}
