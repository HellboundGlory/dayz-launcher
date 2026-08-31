use thiserror::Error;

/// Failure starting a child process.
#[derive(Debug, Error)]
pub enum SpawnError {
    #[error("launch process error: {0}")]
    Launch(#[from] std::io::Error),
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("invalid dzsa:// URI: {0}")]
    InvalidUri(String),
    #[error("failed to access Windows registry: {0}")]
    Registry(#[from] std::io::Error),
}
