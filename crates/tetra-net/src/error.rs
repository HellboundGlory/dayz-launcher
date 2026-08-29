use std::net::SocketAddr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NetError {
    #[error("no response from {addr} after {attempts} attempts")]
    NoResponse { addr: SocketAddr, attempts: u32 },
    /// The exchange got at least as far as a first reply — a challenge, or a
    /// split-response header — and then stalled before completing, past the
    /// overall per-exchange deadline (see `query::EXCHANGE_TIMEOUT_MULTIPLIER`).
    ///
    /// Distinct from `NoResponse`, which is "nothing came back at all"
    /// (offline, firewalled, wrong port): this is a server that is reachable
    /// and was mid-conversation, so callers on the interactive path can give
    /// the player a truer explanation than "may be offline or behind a
    /// firewall".
    #[error("{addr} stopped responding part-way through a multi-part reply")]
    ExchangeTimedOut { addr: SocketAddr },
    #[error(transparent)]
    Core(#[from] tetra_core::CoreError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
