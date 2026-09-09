//! Steam Web API client and the crawl driver that walks a [`crate::plan`].

use crate::plan::{Shard, CAP_THRESHOLD, REQUEST_LIMIT};
use serde::Deserialize;
use std::collections::{HashSet, VecDeque};
use std::fmt;
use std::net::SocketAddrV4;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::task::JoinSet;

const ENDPOINT: &str = "https://api.steampowered.com/IGameServersService/GetServerList/v1/";

/// Total attempts per shard. A shard that still fails is reported and skipped:
/// the crawl is a best-effort sweep, not a transaction.
const ATTEMPTS: u32 = 3;
const RETRY_BACKOFF: Duration = Duration::from_secs(1);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Ceiling on requests per crawl, so a list that suddenly refuses to split
/// cannot eat the ~100k/day key quota. 4,096 is ten times the measured 417.
pub const FULL_BUDGET: usize = 4_096;
/// The hot crawl is one request; a couple of splits is generous headroom.
pub const HOT_BUDGET: usize = 4;

#[derive(Debug)]
pub enum SteamError {
    /// Transport failure, with the URL stripped — it carries the API key.
    Http(String),
    Status(u16),
    Decode(String),
}

impl fmt::Display for SteamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Http(e) => write!(f, "request failed: {e}"),
            Self::Status(code) => write!(f, "HTTP {code}"),
            Self::Decode(e) => write!(f, "malformed response: {e}"),
        }
    }
}

impl std::error::Error for SteamError {}

#[derive(Debug, Deserialize, Default)]
struct Envelope {
    #[serde(default)]
    response: ResponseBody,
}

#[derive(Debug, Deserialize, Default)]
struct ResponseBody {
    /// Absent, not empty, when nothing matches the filter.
    #[serde(default)]
    servers: Vec<SteamServer>,
}

/// One row of the master list. Everything but `addr` is optional: these are
/// other people's advertisements and any field may be missing or junk.
#[derive(Debug, Clone, Deserialize)]
pub struct SteamServer {
    /// `ip:query_port`.
    pub addr: String,
    #[serde(default)]
    pub gameport: u16,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub map: String,
    #[serde(default)]
    pub players: i32,
    #[serde(default)]
    pub max_players: i32,
    #[serde(default)]
    pub bots: i32,
    #[serde(default)]
    pub version: Option<String>,
    /// The A2S keyword string.
    #[serde(default)]
    pub gametype: Option<String>,
    #[serde(default)]
    pub secure: bool,
}

impl SteamServer {
    /// `None` for a row whose address isn't an IPv4 socket — a hostname, an
    /// IPv6 literal, or garbage. Dropped rather than guessed at.
    pub fn socket(&self) -> Option<SocketAddrV4> {
        self.addr.parse::<SocketAddrV4>().ok()
    }
}

#[derive(Clone)]
pub struct SteamClient {
    http: reqwest::Client,
    key: String,
}

impl SteamClient {
    pub fn new(key: String) -> Result<Self, SteamError> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("tetra-indexer/", env!("CARGO_PKG_VERSION")))
            .timeout(REQUEST_TIMEOUT)
            .gzip(true)
            .build()
            .map_err(|e| SteamError::Http(e.without_url().to_string()))?;
        Ok(Self { http, key })
    }

    /// One `GetServerList` request, retried on transport and 5xx failures.
    pub async fn server_list(
        &self,
        filter: &str,
        limit: usize,
    ) -> Result<Vec<SteamServer>, SteamError> {
        let mut backoff = RETRY_BACKOFF;
        let mut last = SteamError::Status(0);
        for attempt in 1..=ATTEMPTS {
            match self.request(filter, limit).await {
                Ok(rows) => return Ok(rows),
                // A rejected key or a bad filter will be rejected again; only
                // transport and server-side faults are worth another try.
                Err(SteamError::Status(code)) if (400..500).contains(&code) => {
                    return Err(SteamError::Status(code))
                }
                Err(e) => {
                    tracing::debug!(filter, attempt, error = %e, "shard request failed");
                    last = e;
                }
            }
            if attempt < ATTEMPTS {
                tokio::time::sleep(backoff).await;
                backoff *= 2;
            }
        }
        Err(last)
    }

    async fn request(&self, filter: &str, limit: usize) -> Result<Vec<SteamServer>, SteamError> {
        // Built through `Url` rather than `RequestBuilder::query`, which is
        // behind a reqwest feature this workspace doesn't enable.
        let mut url = reqwest::Url::parse(ENDPOINT)
            .map_err(|e| SteamError::Http(format!("bad endpoint: {e}")))?;
        url.query_pairs_mut()
            .append_pair("key", &self.key)
            .append_pair("filter", filter)
            .append_pair("limit", &limit.to_string());
        let res = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|e| SteamError::Http(e.without_url().to_string()))?;
        if !res.status().is_success() {
            return Err(SteamError::Status(res.status().as_u16()));
        }
        let body = res
            .bytes()
            .await
            .map_err(|e| SteamError::Http(e.without_url().to_string()))?;
        let envelope: Envelope =
            serde_json::from_slice(&body).map_err(|e| SteamError::Decode(e.to_string()))?;
        Ok(envelope.response.servers)
    }
}

#[derive(Debug, Default)]
pub struct CrawlStats {
    pub requests: usize,
    pub rows: usize,
    /// Distinct addresses, which is what the crawl actually yields — shards
    /// overlap wherever an axis has no exact complement.
    pub unique: usize,
    /// Cells that came back at the cap with no axis left to cut them on.
    pub truncated: usize,
    pub errors: usize,
    pub budget_exhausted: bool,
    pub elapsed: Duration,
}

/// Walk `roots`, subdividing every cell that comes back at the row cap, and
/// forward each newly seen address to `sink` as it arrives.
pub async fn crawl(
    client: &SteamClient,
    roots: Vec<Shard>,
    concurrency: usize,
    budget: usize,
    sink: mpsc::Sender<Vec<SteamServer>>,
    mut aborted: impl FnMut() -> bool + Send,
) -> CrawlStats {
    let started = Instant::now();
    let mut stats = CrawlStats::default();
    let mut seen: HashSet<SocketAddrV4> = HashSet::new();
    let mut queue: VecDeque<Shard> = roots.into();
    let mut inflight: JoinSet<(Shard, Result<Vec<SteamServer>, SteamError>)> = JoinSet::new();

    loop {
        // Abort between requests, not mid-request: a shutdown during a
        // ~160 s full crawl must not have to kill the loop to stop it.
        if aborted() {
            tracing::warn!(
                requests = stats.requests,
                unique = stats.unique,
                "crawl aborted"
            );
            break;
        }
        while inflight.len() < concurrency.max(1) {
            if stats.requests >= budget {
                stats.budget_exhausted = !queue.is_empty();
                queue.clear();
            }
            let Some(shard) = queue.pop_front() else {
                break;
            };
            stats.requests += 1;
            let client = client.clone();
            inflight.spawn(async move {
                let rows = client.server_list(&shard.filter(), REQUEST_LIMIT).await;
                (shard, rows)
            });
        }

        let Some(joined) = inflight.join_next().await else {
            break;
        };
        let (shard, result) = match joined {
            Ok(pair) => pair,
            Err(e) => {
                tracing::warn!(error = %e, "crawl task failed");
                stats.errors += 1;
                continue;
            }
        };
        let rows = match result {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(filter = %shard.filter(), error = %e, "shard gave up");
                stats.errors += 1;
                continue;
            }
        };

        stats.rows += rows.len();
        let capped = rows.len() >= CAP_THRESHOLD;
        let fresh: Vec<SteamServer> = rows
            .into_iter()
            .filter(|row| match row.socket() {
                Some(sock) => seen.insert(sock),
                None => false,
            })
            .collect();
        stats.unique = seen.len();
        if !fresh.is_empty() && sink.send(fresh).await.is_err() {
            tracing::warn!("ingest closed, abandoning crawl");
            break;
        }

        if capped {
            let children = shard.split();
            if children.is_empty() {
                stats.truncated += 1;
                tracing::debug!(filter = %shard.filter(), "truncated with no axis left");
            } else {
                queue.extend(children);
            }
        }
    }

    stats.elapsed = started.elapsed();
    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_servers_key_is_an_empty_list() {
        let envelope: Envelope = serde_json::from_slice(br#"{"response":{}}"#).unwrap();
        assert!(envelope.response.servers.is_empty());
        let envelope: Envelope = serde_json::from_slice(br#"{}"#).unwrap();
        assert!(envelope.response.servers.is_empty());
    }

    #[test]
    fn a_row_with_an_unusable_address_does_not_sink_the_batch() {
        let body = br#"{"response":{"servers":[
            {"addr":"92.234.193.223:27016","gameport":2302,"name":"Noodles Server",
             "appid":221100,"players":1,"max_players":60,"bots":0,"map":"chernarusplus",
             "secure":true,"version":"1.29.163709","gametype":"battleye,external"},
            {"addr":"dayz.example.com:2302","name":"hostname instead of an ip"},
            {"addr":"","name":"nothing at all"},
            {"addr":"10.0.0.5:27016"}
        ]}}"#;
        let envelope: Envelope = serde_json::from_slice(body).unwrap();
        let rows = envelope.response.servers;
        assert_eq!(rows.len(), 4);
        // Both usable addresses survive; the unusable ones resolve to None
        // instead of failing the whole response.
        let usable: Vec<_> = rows.iter().filter_map(|r| r.socket()).collect();
        assert_eq!(
            usable,
            vec![
                "92.234.193.223:27016".parse::<SocketAddrV4>().unwrap(),
                "10.0.0.5:27016".parse::<SocketAddrV4>().unwrap(),
            ]
        );
        // Missing fields fall back rather than erroring.
        assert_eq!(rows[3].name, "");
        assert_eq!(rows[3].max_players, 0);
        assert_eq!(rows[0].gametype.as_deref(), Some("battleye,external"));
    }
}
