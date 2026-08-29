#![forbid(unsafe_code)]

//! SQLite registry. The sole owner of SQL in this project.
//!
//! No other crate writes a query. That is what makes the storage layer
//! replaceable and the filter semantics testable in one place.

pub mod error;
pub mod filter;
pub mod reader;
pub mod rows;
pub mod schema;
pub mod writer;

pub use error::RegistryError;
pub use filter::{ServerFilter, ServerListRow, SortDir, SortKey};
pub use reader::Reader;
pub use rows::{ServerKey, ServerRow};
pub use writer::Writer;

use rusqlite::Connection;
use std::path::Path;
use tokio::sync::mpsc;

pub struct Registry {
    uri: String,
    writer: Writer,
}

impl Registry {
    pub fn open(path: impl AsRef<Path>) -> Result<Registry, RegistryError> {
        Self::start(path.as_ref().to_string_lossy().into_owned())
    }

    /// An in-memory database that survives being opened by several
    /// connections. A plain `:memory:` gives each connection its own private
    /// database, so the writer thread and the readers would never see each
    /// other's data.
    pub fn open_in_memory() -> Result<Registry, RegistryError> {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let id = N.fetch_add(1, Ordering::Relaxed);
        Self::start(format!("file:tetra-mem-{id}?mode=memory&cache=shared"))
    }

    fn start(uri: String) -> Result<Registry, RegistryError> {
        let conn = Self::connect(&uri)?;
        schema::migrate(&conn)?;
        // Best-effort: a prune failure must not stop the registry from
        // opening. See `schema::prune_stale` (M14, 2026-08-29 audit).
        let _ = schema::prune_stale(&conn);

        let (tx, rx) = mpsc::channel(64);
        std::thread::Builder::new()
            .name("tetra-registry-writer".into())
            .spawn(move || writer::run(conn, rx))
            .map_err(|e| RegistryError::Migration(e.to_string()))?;

        Ok(Registry {
            uri,
            writer: Writer::new(tx),
        })
    }

    fn connect(uri: &str) -> Result<Connection, RegistryError> {
        let conn = if uri.starts_with("file:") {
            Connection::open_with_flags(
                uri,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                    | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                    | rusqlite::OpenFlags::SQLITE_OPEN_URI,
            )?
        } else {
            Connection::open(uri)?
        };
        schema::apply_pragmas(&conn)?;
        Ok(conn)
    }

    pub fn writer(&self) -> Writer {
        self.writer.clone()
    }

    /// A fresh read connection. Readers are cheap and independent; WAL lets
    /// them run while the writer thread is mid-transaction.
    pub fn reader(&self) -> Result<Reader, RegistryError> {
        Reader::new(Self::connect(&self.uri)?)
    }
}
