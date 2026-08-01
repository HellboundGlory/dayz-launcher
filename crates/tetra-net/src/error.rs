use std::net::SocketAddr;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum NetError {
    #[error("no response from {addr} after {attempts} attempts")]
    NoResponse { addr: SocketAddr, attempts: u32 },
    #[error(transparent)]
    Core(#[from] tetra_core::CoreError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}