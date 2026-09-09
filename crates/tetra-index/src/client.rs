//! HTTP client for a `tetra-indexer` backend.
//!
//! Every method is written on the assumption that the backend may be absent,
//! slow, or serving a schema this build doesn't know: those are ordinary
//! outcomes, not exceptions, because the launcher's own Steam pass is always
//! there to fall back to.

use crate::{paths, Health, ServerDetail, Snapshot, FORMAT_VERSION};
use std::time::Duration;

/// Ceiling on a decompressed snapshot. The live index is ~270k addresses at
/// roughly 250 bytes of JSON each, so this leaves ~4x headroom while still
/// refusing to buffer an unbounded body into memory.
pub const MAX_SNAPSHOT_BYTES: usize = 256 * 1024 * 1024;

/// Whole-request budget for the bulk snapshot. Generous: it is one large body
/// on a cold start, and giving up early just means a 17-minute Steam pass.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(180);

/// Whole-request budget for the small endpoints, where a slow answer is worse
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
    #[error("index response exceeded {MAX_SNAPSHOT_BYTES} bytes")]
    TooLarge,
    #[error("index response was not valid JSON: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("invalid index url: {0}")]
    Url(String),
}

/// A conditional GET's two outcomes.
#[derive(Debug)]
pub enum Fetch<T> {
    /// The `ETag` we sent still matches; nothing was transferred.
    NotModified,
    Fresh {
        etag: Option<String>,
        body: T,
    },
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

    pub async fn health(&self) -> Result<Health, IndexError> {
        let res = self
            .http
            .get(format!("{}{}", self.base, paths::HEALTH))
            .timeout(SMALL_TIMEOUT)
            .send()
            .await?;
        let res = check_status(res)?;
        let health: Health = serde_json::from_slice(&res.bytes().await?)?;
        check_format(health.format_version)?;
        Ok(health)
    }

    /// The whole list. `etag` is the one from a previous [`Fetch::Fresh`];
    /// passing it turns an unchanged snapshot into a 304 with no body.
    pub async fn snapshot(&self, etag: Option<&str>) -> Result<Fetch<Snapshot>, IndexError> {
        self.fetch_snapshot(format!("{}{}", self.base, paths::SNAPSHOT), etag)
            .await
    }

    /// Only what changed since `since` (a previous [`Snapshot::cursor`]). The
    /// backend answers with a full snapshot instead when `since` is older than
    /// the window it keeps, so callers must honour [`Snapshot::partial`]
    /// rather than assuming this returns a delta.
    pub async fn delta(&self, since: i64) -> Result<Fetch<Snapshot>, IndexError> {
        self.fetch_snapshot(format!("{}{}?since={since}", self.base, paths::DELTA), None)
            .await
    }

    /// One server, with its mod names resolved. `Ok(None)` is a 404 — the
    /// index has never seen that address.
    pub async fn server(&self, addr: &str) -> Result<Option<ServerDetail>, IndexError> {
        let res = self
            .http
            .get(format!("{}{}{addr}", self.base, paths::SERVER))
            .timeout(SMALL_TIMEOUT)
            .send()
            .await?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let res = check_status(res)?;
        let detail: ServerDetail = serde_json::from_slice(&res.bytes().await?)?;
        check_format(detail.format_version)?;
        Ok(Some(detail))
    }

    async fn fetch_snapshot(
        &self,
        url: String,
        etag: Option<&str>,
    ) -> Result<Fetch<Snapshot>, IndexError> {
        let mut req = self.http.get(url).timeout(SNAPSHOT_TIMEOUT);
        if let Some(etag) = etag {
            req = req.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        let res = req.send().await?;
        if res.status() == reqwest::StatusCode::NOT_MODIFIED {
            return Ok(Fetch::NotModified);
        }
        let res = check_status(res)?;
        let etag = res
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);

        // Accumulated chunk by chunk rather than with `bytes()` so a
        // misconfigured or hostile origin can't make the launcher allocate
        // without bound — `Content-Length` is the compressed size and says
        // nothing about what gzip expands to.
        let mut buf: Vec<u8> = Vec::with_capacity(8 * 1024 * 1024);
        let mut res = res;
        while let Some(chunk) = res.chunk().await? {
            if buf.len() + chunk.len() > MAX_SNAPSHOT_BYTES {
                return Err(IndexError::TooLarge);
            }
            buf.extend_from_slice(&chunk);
        }

        let snapshot: Snapshot = serde_json::from_slice(&buf)?;
        check_format(snapshot.format_version)?;
        Ok(Fetch::Fresh {
            etag,
            body: snapshot,
        })
    }
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
}
