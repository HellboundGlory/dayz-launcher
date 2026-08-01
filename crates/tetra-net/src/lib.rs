#![forbid(unsafe_code)]

//! Async UDP transport for A2S queries.
//!
//! Every query owns its own socket for the whole exchange. That is deliberate:
//! a shared socket would put all queries on one source port, and two in-flight
//! split-packet sets from the same server would then be indistinguishable.

pub mod config;
pub mod error;
pub mod prober;
pub mod query;
pub mod retry;

pub use config::{ProbeConfig, MAX_IN_FLIGHT};
pub use error::NetError;
pub use prober::{ProbeOutcome, Prober};
pub use query::{query_info, query_info_raw, query_rules, query_rules_raw};
pub use retry::with_retries;
