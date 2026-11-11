use std::net::SocketAddr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NetError {
    #[error("no response from {addr} after {attempts} attempts")]
    NoResponse { addr: SocketAddr, attempts: u32 },
    /// Server replied at least once, then stalled mid-exchange — distinct
    /// from `NoResponse` (nothing came back at all).
    #[error("{addr} stopped responding part-way through a multi-part reply")]
    ExchangeTimedOut { addr: SocketAddr },
    /// Something answered A2S_INFO, but it was another game on that port.
    #[error("{addr} is not a DayZ server")]
    NotDayZ { addr: SocketAddr },
    #[error(transparent)]
    Core(#[from] tetra_core::CoreError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
