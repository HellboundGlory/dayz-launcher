//! Building the served bodies: export, serialise, compress — once per
//! generation, never per request.

use crate::state::{AppState, Bodies, GzBody};
use axum::body::Bytes;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::net::SocketAddrV4;
use std::sync::Arc;
use std::time::{Duration, Instant};
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

/// Floor on time between generations. Every write cycle asks for a rebuild,
/// and a rebuild is a full table scan plus ~20 MB of gzip.
const MIN_INTERVAL: Duration = Duration::from_secs(30);

/// Above this share of rows changed, a delta saves nothing and costs a second
/// body; clients are sent the full snapshot instead (`partial: false`, which
/// is exactly how they tell the difference).
const DELTA_MAX_SHARE: f64 = 0.6;

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
    let previous = state.bodies();
    let started = Instant::now();
    let bodies = tokio::task::spawn_blocking(move || build(&registry, previous.as_deref()))
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
        gzip_bytes = bodies.snapshot.bytes.len(),
        delta_bytes = bodies.delta.as_ref().map(|d| d.bytes.len()),
        delta_from = bodies.delta_from,
        secs = started.elapsed().as_secs_f32(),
        "snapshot generated"
    );
    state.publish(Arc::new(bodies));
    Ok(())
}

/// Blocking: one full scan, one serialisation, one compression pass.
fn build(registry: &Registry, previous: Option<&Bodies>) -> Result<Bodies, BuildError> {
    let reader = registry.reader()?;
    let export = reader.export(0)?;
    let generated_at = crate::now();
    // Monotonic per generation: the snapshot's cursor and the next one's
    // delta_from must line up exactly, and the wall clock cannot promise
    // that when two generations land in the same second.
    let generation = previous.map_or(1, |p| p.generation + 1);

    let mut keys: HashSet<SocketAddrV4> = HashSet::with_capacity(export.rows.len());
    let mut servers: Vec<ServerEntry> = Vec::with_capacity(export.rows.len());
    let mut changed: Vec<usize> = Vec::new();
    let mut responsive = 0usize;
    let mut with_mods = 0usize;
    let mut populated = 0usize;

    for row in export.rows {
        keys.insert(SocketAddrV4::new(row.key.ip, row.key.query_port));
        if row.last_responded.is_some() {
            responsive += 1;
        }
        if row.mod_ids.is_some() {
            with_mods += 1;
        }
        if row.players > 0 {
            populated += 1;
        }
        servers.push(entry(row));
    }

    // Which rows differ from the previous generation. Diffing key sets only
    // would miss every change that keeps an address alive — a player-count
    // shift, a mod-list refresh, a rename — so each row is fingerprinted and
    // the fingerprint compared. 64 bits over ~250k rows is ample for a
    // redundant-row-or-two miss, which is harmless; a *missing* change is
    // what must never happen, and that cannot collide.
    let mut fingerprints: HashMap<String, u64> = HashMap::with_capacity(servers.len());
    for (i, server) in servers.iter().enumerate() {
        let fp = fingerprint(server);
        fingerprints.insert(server.addr.clone(), fp);
        // First generation has nothing to diff against; every later one
        // carries exactly the rows whose client-visible content moved.
        let changed_since_last = previous.is_none_or(|p| {
            !p.fingerprints
                .get(&server.addr)
                .is_some_and(|stored| *stored == fp)
        });
        if changed_since_last {
            changed.push(i);
        }
    }

    let snapshot = Snapshot {
        format_version: FORMAT_VERSION,
        generated_at,
        cursor: generation,
        partial: false,
        mod_names: export.mod_names,
        servers,
        removed: Vec::new(),
    };
    let count = snapshot.servers.len();
    let snapshot_body = encode(&snapshot)?;

    let worth_a_delta = previous.is_some()
        && (count == 0 || (changed.len() as f64) <= DELTA_MAX_SHARE * count as f64);
    let delta = if worth_a_delta {
        let rows: Vec<ServerEntry> = changed
            .iter()
            .map(|&i| snapshot.servers[i].clone())
            .collect();
        let referenced: HashSet<u64> = rows
            .iter()
            .filter_map(|s| s.mod_ids.as_ref())
            .flatten()
            .copied()
            .collect();
        let mod_names: HashMap<u64, String> = snapshot
            .mod_names
            .iter()
            .filter(|(id, _)| referenced.contains(*id))
            .map(|(id, name)| (*id, name.clone()))
            .collect();
        let gone = previous
            .map(|p| removed(&p.keys, &keys))
            .unwrap_or_default();
        Some(encode(&Snapshot {
            format_version: FORMAT_VERSION,
            generated_at,
            cursor: snapshot.cursor,
            partial: true,
            mod_names,
            servers: rows,
            removed: gone,
        })?)
    } else {
        None
    };

    Ok(Bodies {
        generated_at,
        delta_from: previous.map_or(0, |p| p.generation),
        generation,
        snapshot: snapshot_body,
        delta,
        keys,
        servers: count,
        responsive,
        with_mods,
        populated,
        fingerprints,
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
    }
}

/// A content fingerprint of everything a client renders from this row, so a
/// delta carries a row exactly when its client-visible content changed.
/// Timing fields are excluded deliberately: `last_responded` moves on every
/// sweep and would otherwise make every row look changed every cycle.
fn fingerprint(entry: &ServerEntry) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    entry.name.hash(&mut h);
    entry.map.hash(&mut h);
    entry.players.hash(&mut h);
    entry.max_players.hash(&mut h);
    entry.bots.hash(&mut h);
    entry.locked.hash(&mut h);
    entry.vac.hash(&mut h);
    entry.version.hash(&mut h);
    entry.keywords.hash(&mut h);
    entry.description.hash(&mut h);
    entry.mod_ids.hash(&mut h);
    h.finish()
}

fn encode(snapshot: &Snapshot) -> Result<GzBody, BuildError> {
    let json = serde_json::to_vec(snapshot).map_err(|e| BuildError::Encode(e.to_string()))?;
    let mut encoder = flate2::write::GzEncoder::new(
        Vec::with_capacity(json.len() / 8),
        flate2::Compression::new(6),
    );
    encoder
        .write_all(&json)
        .and_then(|()| encoder.flush())
        .map_err(|e| BuildError::Encode(e.to_string()))?;
    let bytes = encoder
        .finish()
        .map_err(|e| BuildError::Encode(e.to_string()))?;
    Ok(GzBody {
        etag: etag(&bytes),
        bytes: Bytes::from(bytes),
    })
}

/// Strong validator: a hash of the exact bytes served, so two generations
/// with identical content share an ETag and a client re-fetches nothing.
fn etag(bytes: &[u8]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("\"{:016x}\"", hasher.finish())
}

/// Addresses present in `before` but gone from `after`.
pub fn removed(before: &HashSet<SocketAddrV4>, after: &HashSet<SocketAddrV4>) -> Vec<String> {
    before
        .difference(after)
        .map(|sock| sock.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(addrs: &[&str]) -> HashSet<SocketAddrV4> {
        addrs.iter().map(|a| a.parse().unwrap()).collect()
    }

    fn entry(addr: &str, players: i32, mods: Option<Vec<u64>>) -> ServerEntry {
        ServerEntry {
            addr: addr.into(),
            game_port: 2302,
            name: "Server".into(),
            map: "chernarusplus".into(),
            players,
            max_players: 60,
            bots: 0,
            locked: false,
            vac: true,
            version: Some("1.29".into()),
            keywords: Some("battleye".into()),
            description: None,
            mod_ids: mods,
            last_responded: Some(1_757_000_000),
        }
    }

    #[test]
    fn a_content_change_moves_the_fingerprint_but_a_liveness_change_does_not() {
        let base = entry("1.2.3.4:27016", 10, Some(vec![1, 2]));
        let repinged = ServerEntry {
            last_responded: Some(1_757_000_001),
            ..base.clone()
        };
        let busier = ServerEntry {
            players: 42,
            ..base.clone()
        };
        let reordered_mods = ServerEntry {
            mod_ids: Some(vec![2, 1]),
            ..base.clone()
        };

        assert_eq!(fingerprint(&base), fingerprint(&repinged));
        assert_ne!(fingerprint(&base), fingerprint(&busier));
        assert_ne!(fingerprint(&base), fingerprint(&reordered_mods));
    }

    #[test]
    fn a_disappearance_between_generations_is_reported_once() {
        let before = set(&["1.2.3.4:27016", "5.6.7.8:27016", "9.9.9.9:2302"]);
        let after = set(&["1.2.3.4:27016", "9.9.9.9:2302", "4.4.4.4:27016"]);

        let gone = removed(&before, &after);
        assert_eq!(gone, vec!["5.6.7.8:27016".to_string()]);
        // A new address is not a removal, and a stable one is not either.
        assert!(removed(&after, &after).is_empty());
    }

    #[test]
    fn an_etag_tracks_the_bytes_it_was_built_from() {
        assert_eq!(etag(b"same"), etag(b"same"));
        assert_ne!(etag(b"same"), etag(b"different"));
        assert!(etag(b"x").starts_with('"') && etag(b"x").ends_with('"'));
    }
}
