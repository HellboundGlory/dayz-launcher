#![forbid(unsafe_code)]

//! Async UDP transport for A2S queries.
//!
//! Each query gets its own socket, so overlapping split-packet responses from
//! the same server never land on the same source port.

pub mod config;
pub mod corroboration;
pub mod error;
pub mod ping;
pub mod prober;
pub mod query;
pub mod retry;

pub use config::{ProbeConfig, MAX_IN_FLIGHT, MAX_IN_FLIGHT_CEILING};
pub use corroboration::offline_marks_suppressed;
pub use error::NetError;
#[cfg(feature = "icmp")]
pub use ping::IcmpPinger;
pub use ping::{estimate_ms, estimate_ping, PingReading, Pinger};
pub use prober::{IcmpStatus, ProbeOutcome, Prober};
pub use query::{
    query_info, query_info_raw, query_info_timed, query_rules, query_rules_raw, TimedInfo,
};
pub use retry::{retry_backoff, with_retries, Verdict};
