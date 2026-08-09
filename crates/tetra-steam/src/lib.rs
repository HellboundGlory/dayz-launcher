#![deny(unsafe_code)]

//! Steamworks access, confined to one thread.
//!
//! The Steamworks client is `!Send` and its callbacks hold `Rc`, so it lives
//! on a thread of its own and is reached only through a channel. Everything
//! outside this crate sees the `ServerListSource` trait, which is what lets
//! discovery be tested with Steam not running.

mod actor;
pub mod error;
pub mod handle;
pub mod rows;
pub mod source;
pub mod workshop;

pub use actor::{
    DownloadRow, MutationResult, StaleOutcome, StreamChunk, SubscribedModInfo, DAYZ_APP_ID,
};
pub use error::{InitFailure, SteamError};
pub use handle::SteamHandle;
pub use rows::{to_server_row, GameServerRow};
pub use source::{Filters, ServerListSource};
pub use workshop::ModState;
