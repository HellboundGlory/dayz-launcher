//! Effective configuration, entirely from the environment.

use std::fmt::Display;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

pub struct Config {
    pub steam_api_key: String,
    pub db: PathBuf,
    pub bind: SocketAddr,
    pub hot_interval: Duration,
    pub full_interval: Duration,
    pub info_interval: Duration,
    pub info_batch: usize,
    pub rules_interval: Duration,
    pub rules_batch: usize,
    pub rules_ttl_secs: i64,
    pub max_in_flight: usize,
    pub crawl_concurrency: usize,
    pub rate_limit_per_min: u32,
    /// Addresses one IP may advertise before the whole IP is treated as an
    /// advert farm and its empty listings dropped. `0` disables.
    pub max_per_ip: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let steam_api_key = std::env::var("STEAM_API_KEY")
            .ok()
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
            .ok_or_else(|| {
                "STEAM_API_KEY is not set. Get a key at \
                 https://steamcommunity.com/dev/apikey and pass it in the \
                 environment (compose: STEAM_API_KEY=...)."
                    .to_string()
            })?;

        let bind_raw = string_env("TETRA_INDEX_BIND", "0.0.0.0:8080");
        let bind = SocketAddr::from_str(&bind_raw)
            .map_err(|e| format!("TETRA_INDEX_BIND ({bind_raw}) is not an ip:port: {e}"))?;

        Ok(Self {
            steam_api_key,
            db: PathBuf::from(string_env("TETRA_INDEX_DB", "/data/index.sqlite")),
            bind,
            hot_interval: secs_env("TETRA_HOT_INTERVAL_SECS", 60),
            // ~1,200 measured requests per full crawl against a ~100k/day
            // quota keeps the crawl inside budget at this cadence.
            full_interval: secs_env("TETRA_FULL_INTERVAL_SECS", 1200),
            info_interval: secs_env("TETRA_INFO_INTERVAL_SECS", 180),
            info_batch: parse_env("TETRA_INFO_BATCH", 60_000),
            rules_interval: secs_env("TETRA_RULES_INTERVAL_SECS", 60),
            rules_batch: parse_env("TETRA_RULES_BATCH", 4_000),
            rules_ttl_secs: parse_env("TETRA_RULES_TTL_SECS", 21_600),
            max_in_flight: parse_env::<usize>("TETRA_MAX_IN_FLIGHT", 1_024)
                .clamp(1, tetra_net::MAX_IN_FLIGHT_CEILING),
            crawl_concurrency: parse_env::<usize>("TETRA_CRAWL_CONCURRENCY", 16).clamp(1, 64),
            rate_limit_per_min: parse_env("TETRA_RATE_LIMIT_PER_MIN", 60),
            max_per_ip: parse_env("TETRA_MAX_PER_IP", 50),
        })
    }

    /// Startup banner. The key is never printed, here or anywhere else.
    pub fn log(&self) {
        tracing::info!(
            steam_api_key = "<redacted>",
            db = %self.db.display(),
            bind = %self.bind,
            hot_interval_secs = self.hot_interval.as_secs(),
            full_interval_secs = self.full_interval.as_secs(),
            info_interval_secs = self.info_interval.as_secs(),
            info_batch = self.info_batch,
            rules_interval_secs = self.rules_interval.as_secs(),
            rules_batch = self.rules_batch,
            rules_ttl_secs = self.rules_ttl_secs,
            max_in_flight = self.max_in_flight,
            crawl_concurrency = self.crawl_concurrency,
            rate_limit_per_min = self.rate_limit_per_min,
            max_per_ip = self.max_per_ip,
            "effective config"
        );
    }
}

fn string_env(name: &str, default: &str) -> String {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => default.to_string(),
    }
}

fn parse_env<T: FromStr + Display + Copy>(name: &str, default: T) -> T {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => match v.trim().parse::<T>() {
            Ok(parsed) => parsed,
            Err(_) => {
                tracing::warn!(var = name, value = %v, %default, "unparseable, using default");
                default
            }
        },
        _ => default,
    }
}

fn secs_env(name: &str, default: u64) -> Duration {
    Duration::from_secs(parse_env(name, default).max(1))
}
