use thiserror::Error;

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("registry writer has shut down")]
    Closed,
    #[error("migration: {0}")]
    Migration(String),
}
