//! Building the served snapshot: export, serialise, compress — once per
//! rebuild, never per request.

use crate::state::{AppState, Bodies};
use axum::body::Bytes;
use std::io::BufWriter;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tetra_core::classify::names::is_default_name;
use tetra_index::{ServerEntry, Snapshot, FORMAT_VERSION};
use tetra_registry::{ExportRow, Registry, RegistryError};
use tokio::sync::watch;

#[derive(Debug)]
pub enum BuildError {
    Registry(RegistryError),
    /// Serialisation or compression of a body that was already read.
    Encode(String),
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Registry(e) => write!(f, "{e}"),
            Self::Encode(e) => write!(f, "encode: {e}"),
        }
    }
}

impl std::error::Error for BuildError {}

impl From<RegistryError> for BuildError {
    fn from(e: RegistryError) -> Self {
        Self::Registry(e)
    }
}

/// Floor on time between rebuilds. Every write cycle asks for a rebuild,
/// and a rebuild is a full table scan serialised and gzipped in one pass.
const MIN_INTERVAL: Duration = Duration::from_secs(30);

/// Servers that have not answered for longer than this are left out of the served index.
const EXPORT_MAX_SILENCE_SECS: i64 = 86_400;

/// Rebuild whenever a write cycle says something changed, no more often than
/// [`MIN_INTERVAL`].
pub async fn run(state: Arc<AppState>, mut shutdown: watch::Receiver<bool>) {
    let mut last: Option<Instant> = None;
    loop {
        tokio::select! {
            _ = state.rebuild.notified() => {}
            _ = shutdown.changed() => return,
        }
        if let Some(since) = last.map(|t: Instant| t.elapsed()) {
            if since < MIN_INTERVAL {
                let wait = MIN_INTERVAL - since;
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    _ = shutdown.changed() => return,
                }
            }
        }
        last = Some(Instant::now());
        match rebuild(&state).await {
            Ok(()) => {}
            Err(e) => tracing::warn!(error = %e, "snapshot build failed"),
        }
    }
}

async fn rebuild(state: &AppState) -> Result<(), BuildError> {
    let registry = Arc::clone(&state.registry);
    let started = Instant::now();
    let bodies = tokio::task::spawn_blocking(move || build(&registry))
        .await
        .map_err(|e| BuildError::Encode(format!("build task failed: {e}")))??;

    // An empty index is never served: clients decide whether to trust the
    // backend from `snapshot_generated_at`, and "fresh, zero servers" would
    // stop them falling back to their own Steam pass.
    if bodies.servers == 0 {
        tracing::warn!("index is empty; keeping the previous snapshot");
        return Ok(());
    }

    tracing::info!(
        servers = bodies.servers,
        responsive = bodies.responsive,
        with_mods = bodies.with_mods,
        populated = bodies.populated,
        gzip_bytes = bodies.snapshot.len(),
        secs = started.elapsed().as_secs_f32(),
        "snapshot generated"
    );
    state.publish(Arc::new(bodies));
    Ok(())
}

/// Blocking: one full scan, one serialisation, one compression pass.
fn build(registry: &Registry) -> Result<Bodies, BuildError> {
    let reader = registry.reader()?;
    let export = reader.export()?;
    let generated_at = crate::now();

    let mut servers: Vec<ServerEntry> = Vec::with_capacity(export.rows.len());
    let mut responsive = 0usize;
    let mut with_mods = 0usize;
    let mut populated = 0usize;

    let served_since = generated_at - EXPORT_MAX_SILENCE_SECS;
    for row in export.rows {
        let answered_lately = row.last_responded.is_some_and(|at| at >= served_since);
        if !answered_lately || is_default_name(&row.name) {
            continue;
        }
        responsive += 1;
        if row.mod_ids.is_some() {
            with_mods += 1;
        }
        if row.players > 0 {
            populated += 1;
        }
        servers.push(entry(row));
    }

    let count = servers.len();
    let snapshot = encode(&Snapshot {
        format_version: FORMAT_VERSION,
        generated_at,
        cursor: generated_at,
        mod_names: export.mod_names,
        servers,
    })?;

    Ok(Bodies {
        generated_at,
        snapshot,
        servers: count,
        responsive,
        with_mods,
        populated,
    })
}

fn entry(row: ExportRow) -> ServerEntry {
    ServerEntry {
        addr: format!("{}:{}", row.key.ip, row.key.query_port),
        game_port: row.game_port,
        name: row.name,
        map: row.map,
        players: row.players,
        max_players: row.max_players,
        bots: row.bots,
        locked: row.locked,
        vac: row.vac,
        version: row.version,
        keywords: row.keywords,
        description: row.description,
        mod_ids: row.mod_ids,
        last_responded: row.last_responded,
        online: row.online,
    }
}

fn encode(snapshot: &Snapshot) -> Result<Bytes, BuildError> {
    let encoder = flate2::write::GzEncoder::new(
        Vec::with_capacity(4 * 1024 * 1024),
        flate2::Compression::new(6),
    );
    // serde_json writes a token at a time and the gzip writer deflates on
    // every write, so buffer between them.
    let mut out = BufWriter::with_capacity(64 * 1024, encoder);
    serde_json::to_writer(&mut out, snapshot).map_err(encode_err)?;
    out.into_inner()
        .map_err(encode_err)?
        .finish()
        .map(Bytes::from)
        .map_err(encode_err)
}

fn encode_err(e: impl std::fmt::Display) -> BuildError {
    BuildError::Encode(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use tetra_registry::{ServerKey, ServerRow};

    #[tokio::test]
    async fn stale_and_default_named_rows_are_not_served() {
        let registry = Registry::open_in_memory().expect("registry");
        let answered = |last_octet: u8, name: &str, age_secs: i64| ServerRow {
            key: ServerKey {
                ip: Ipv4Addr::new(203, 0, 113, last_octet),
                query_port: 27016,
            },
            name: name.into(),
            responded: true,
            responded_at: Some(crate::now() - age_secs),
            ..Default::default()
        };
        registry
            .writer()
            .upsert_servers(vec![
                answered(1, "Survivor Haven", 3600),
                answered(2, "Survivor Haven", EXPORT_MAX_SILENCE_SECS + 3600),
                answered(3, "EXAMPLE NAME", 3600),
            ])
            .await
            .expect("write");

        let bodies = build(&registry).expect("build");
        assert_eq!(bodies.servers, 1);
    }
}
