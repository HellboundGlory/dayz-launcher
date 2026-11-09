#![forbid(unsafe_code)]

//! A2S wire-format parsing and server classification. No transport, no I/O —
//! every entry point takes bytes that some other crate already read.

pub mod a2s;
pub mod classify;
pub mod error;
pub mod ping;
mod time;

pub use a2s::rules::RulePairs;
pub use error::{CoreError, PackedError, ParseError};
pub use ping::PingKind;
pub use time::unix_now;
