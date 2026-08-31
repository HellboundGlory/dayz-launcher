#![forbid(unsafe_code)]

//! Pre-launch mod gate, `dzsa://` protocol handler, and DayZ process spawn.
//! Validates required mods, builds the `-mod=` argument, and starts the game.
//!
//! # Safety
//!
//! `-mod=` is passed as a single argument, never through a shell.

pub mod error;
pub mod modline;
pub mod protocol;
pub mod registry_discovery;
pub mod running;
pub mod spawn;
