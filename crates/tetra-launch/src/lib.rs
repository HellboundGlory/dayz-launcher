#![forbid(unsafe_code)]

//! Pre-launch mod gate, `dzsa://` protocol handler, and DayZ process spawn.
//!
//! This crate is what turns TetraLauncher from a server browser into a
//! launcher. It validates that every mod a server requires is installed and
//! up-to-date before DayZ is allowed to start, constructs the `-mod=` argument
//! in the server's declared order, and spawns the game process.
//!
//! # Safety
//!
//! The `-mod=` line is constructed as a single argument — never passed through
//! a shell — and no string interpolated into it is user-controlled.

pub mod error;
pub mod gate;
pub mod modline;
pub mod protocol;
pub mod registry_discovery;
pub mod spawn;