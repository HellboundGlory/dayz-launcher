#![forbid(unsafe_code)]

//! Async UDP transport for A2S queries.
//!
//! Each query gets its own socket, so overlapping split-packet responses from
//! the same server never land on the same source port.

pub mod config;
pub mod error;
pub mod prober;
pub mod query;
pub mod retry;

pub use config::{ProbeConfig, MAX_IN_FLIGHT, MAX_IN_FLIGHT_CEILING};
pub use error::NetError;
pub use prober::{ProbeOutcome, Prober};
pub use query::{query_info, query_info_raw, query_rules, query_rules_raw};
pub use retry::with_retries;
