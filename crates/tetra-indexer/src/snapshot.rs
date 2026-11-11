//! Building the served snapshot: export, serialise, compress — once per
//! rebuild, never per request.

use crate::state::{AppState, Bodies};
use axum::body::Bytes;
use std::io::{BufWriter, Write};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tetra_core::classify::names::is_default_name;
use tetra_index::{ServerEntry, FORMAT_VERSION};
use tetra_registry::{
    ExportError, ExportRow, Reader, Registry, RegistryError, ANSWERED_WITHIN_SECS,
};
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

/// Blocking: one scan, with each server compressed as it is read.
fn build(registry: &Registry) -> Result<Bodies, BuildError> {
    let reader = registry.reader()?;
    let generated_at = crate::now();

    let encoder = flate2::write::GzEncoder::new(
        Vec::with_capacity(4 * 1024 * 1024),
        flate2::Compression::new(6),
    );
    // serde_json writes a token at a time and the gzip writer deflates on
    // every write, so buffer between them.
    let mut out = BufWriter::with_capacity(64 * 1024, encoder);
    let counts = write_body(&reader, generated_at, &mut out)?;
    let snapshot = out
        .into_inner()
        .map_err(encode_err)?
        .finish()
        .map(Bytes::from)
        .map_err(encode_err)?;

    Ok(Bodies {
        generated_at,
        snapshot,
        servers: counts.servers,
        responsive: counts.responsive,
        with_mods: counts.with_mods,
        populated: counts.populated,
    })
}

#[derive(Default)]
struct Counts {
    servers: usize,
    responsive: usize,
    with_mods: usize,
    populated: usize,
}

/// Writes the snapshot body. Each served server goes out as it is read, so
/// the list is never held in memory; the name table follows the servers
/// because it is only complete once every row has been read.
fn write_body(
    reader: &Reader,
    generated_at: i64,
    out: &mut impl Write,
) -> Result<Counts, BuildError> {
    write!(
        out,
        r#"{{"formatVersion":{FORMAT_VERSION},"generatedAt":{generated_at},"cursor":{generated_at},"servers":["#
    )
    .map_err(encode_err)?;

    let served_since = generated_at - ANSWERED_WITHIN_SECS;
    let mut counts = Counts::default();
    let mod_names = reader
        .export_each(|row| {
            let answered_lately = row.last_responded.is_some_and(|at| at >= served_since);
            if !answered_lately || is_default_name(&row.name) {
                return Ok(());
            }
            counts.responsive += 1;
            if row.mod_ids.is_some() {
                counts.with_mods += 1;
            }
            if row.players > 0 {
                counts.populated += 1;
            }
            if counts.servers > 0 {
                out.write_all(b",").map_err(encode_err)?;
            }
            counts.servers += 1;
            serde_json::to_writer(&mut *out, &entry(row)).map_err(encode_err)
        })
        .map_err(|e| match e {
            ExportError::Registry(e) => BuildError::Registry(e),
            ExportError::Visit(e) => e,
        })?;

    out.write_all(br#"],"modNames":"#).map_err(encode_err)?;
    serde_json::to_writer(&mut *out, &mod_names).map_err(encode_err)?;
    out.write_all(b"}").map_err(encode_err)?;
    Ok(counts)
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
        online_checked_at: row.online_checked_at,
    }
}

fn encode_err(e: impl std::fmt::Display) -> BuildError {
    BuildError::Encode(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::Ipv4Addr;
    use tetra_core::a2s::dayz::ServerMod;
    use tetra_index::Snapshot;
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
                answered(2, "Survivor Haven", ANSWERED_WITHIN_SECS + 3600),
                answered(3, "EXAMPLE NAME", 3600),
            ])
            .await
            .expect("write");

        let bodies = build(&registry).expect("build");
        assert_eq!(bodies.servers, 1);
    }

    #[tokio::test]
    async fn the_streamed_body_matches_the_collected_snapshot() {
        let registry = Registry::open_in_memory().expect("registry");
        let now = crate::now();
        let writer = registry.writer();
        let server = |last_octet: u8, name: &str, responded_at: i64| ServerRow {
            key: ServerKey {
                ip: Ipv4Addr::new(203, 0, 113, last_octet),
                query_port: 27016,
            },
            name: name.into(),
            responded: true,
            responded_at: Some(responded_at),
            ..Default::default()
        };
        writer
            .upsert_servers(vec![
                server(1, "Survivor Haven", now - 60),
                server(2, "Chernarus Night", now - 60),
                server(3, "Namalsk Run", now - 60),
                server(4, "Livonia Works", now - 60),
                server(5, "Stale Mods", now - ANSWERED_WITHIN_SECS - 3600),
                server(6, "EXAMPLE NAME", now - 60),
                server(9, "Takistan Nine", now - 60),
                server(10, "Deer Isle Ten", now - 60),
            ])
            .await
            .expect("servers");
        let mod_key = |last_octet: u8| ServerKey {
            ip: Ipv4Addr::new(203, 0, 113, last_octet),
            query_port: 27016,
        };
        let mod_of = |workshop_id: u64, name: &str| ServerMod {
            workshop_id,
            name: name.into(),
            hash: None,
        };
        writer
            .upsert_server_mods(
                mod_key(1),
                vec![
                    mod_of(1_111_111_111, "Mod A"),
                    mod_of(2_222_222_222, "Mod B"),
                ],
            )
            .await
            .expect("mods");
        writer
            .upsert_server_mods(mod_key(3), Vec::new())
            .await
            .expect("mods");
        writer
            .upsert_server_mods(
                mod_key(4),
                vec![mod_of(1_111_111_111, "Mod A"), mod_of(3_333_333_333, "")],
            )
            .await
            .expect("mods");
        writer
            .upsert_server_mods(mod_key(5), vec![mod_of(4_444_444_444, "Mod D")])
            .await
            .expect("mods");

        // .10 sorts before .9 as text, which the database orders by.
        writer
            .upsert_server_mods(mod_key(9), vec![mod_of(5_555_555_555, "Mod E")])
            .await
            .expect("mods");
        writer
            .upsert_server_mods(mod_key(10), vec![mod_of(6_666_666_666, "Mod F")])
            .await
            .expect("mods");

        let reader = registry.reader().expect("reader");
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::new(6));
        write_body(&reader, now, &mut gz).expect("write body");
        let mut json = String::new();
        flate2::read::GzDecoder::new(&gz.finish().expect("gzip")[..])
            .read_to_string(&mut json)
            .expect("gunzip");
        let streamed: Snapshot = serde_json::from_str(&json).expect("parse as snapshot");
        let mods_of = |last_octet: u8| {
            let addr = format!("203.0.113.{last_octet}:27016");
            streamed
                .servers
                .iter()
                .find(|s| s.addr == addr)
                .unwrap_or_else(|| panic!("{addr} served"))
                .mod_ids
                .clone()
        };
        assert_eq!(mods_of(1), Some(vec![1_111_111_111, 2_222_222_222]));
        assert_eq!(mods_of(2), None);
        assert_eq!(mods_of(3), Some(vec![]));
        assert_eq!(mods_of(4), Some(vec![1_111_111_111, 3_333_333_333]));
        assert_eq!(mods_of(9), Some(vec![5_555_555_555]));
        assert_eq!(mods_of(10), Some(vec![6_666_666_666]));

        let export = reader.export().expect("export");
        let served: Vec<ServerEntry> = export
            .rows
            .into_iter()
            .filter(|row| {
                row.last_responded
                    .is_some_and(|at| at >= now - ANSWERED_WITHIN_SECS)
                    && !is_default_name(&row.name)
            })
            .map(entry)
            .collect();
        let expected = Snapshot {
            format_version: FORMAT_VERSION,
            generated_at: now,
            cursor: now,
            mod_names: export.mod_names,
            servers: served,
        };
        assert_eq!(
            serde_json::to_value(&streamed).expect("value"),
            serde_json::to_value(&expected).expect("value"),
        );
    }
}
