//! A2S sweeps. The Steam list says an address exists; only these say what is
//! actually running there.

use crate::config::Config;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tetra_core::a2s::dayz::ServerMod;
use tetra_net::Prober;
use tetra_registry::{Registry, RegistryError, ServerKey, ServerRow, Writer};
use tokio::task::JoinSet;

#[derive(Debug)]
pub enum SweepError {
    Registry(RegistryError),
    /// The blocking read task itself failed, which means a panic in it.
    Task(String),
}

impl std::fmt::Display for SweepError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Registry(e) => write!(f, "{e}"),
            Self::Task(e) => write!(f, "read task: {e}"),
        }
    }
}

impl std::error::Error for SweepError {}

impl From<RegistryError> for SweepError {
    fn from(e: RegistryError) -> Self {
        Self::Registry(e)
    }
}

/// Rows per write call during a sweep.
const WRITE_BATCH: usize = 2_000;
/// Keys per `set_online` / `mark_probe_attempt` call.
const KEY_BATCH: usize = 4_000;

/// How long a never-answering address is left alone after we last asked, so a
/// short backlog doesn't mean re-probing the same dead rows every pass.
const RESOLVE_RETRY_AFTER_SECS: i64 = 60 * 60;

/// Ceiling on one server's whole A2S_RULES retry chain, measured from when a
/// permit is acquired rather than from when the task was spawned.
const RULES_DEADLINE: Duration = Duration::from_secs(8);

/// Below this batch size a miss is written as offline unconditionally — too
/// few data points to tell "down" from "our uplink hiccuped" by ratio.
const MIN_BATCH_FOR_OFFLINE_CORROBORATION: usize = 8;

/// Share of a batch that must fail before a miss is read as our own network
/// rather than the server being down.
const OFFLINE_CORROBORATION_THRESHOLD: f64 = 0.4;

/// Servers probed for mods concurrently, independent of how long the backlog
/// is. Sized off the prober's own concurrency, as the launcher does.
fn rules_fanout(prober: &Prober) -> usize {
    prober
        .config()
        .max_in_flight
        .saturating_mul(2)
        .clamp(64, 1000)
}

#[derive(Debug, Default)]
pub struct InfoStats {
    pub probed: usize,
    pub answered: usize,
    pub failed: usize,
    pub offline_marks_suppressed: bool,
    pub elapsed: Duration,
}

#[derive(Debug, Default)]
pub struct RulesStats {
    pub probed: usize,
    pub answered: usize,
    pub mods: usize,
    pub elapsed: Duration,
}

/// One rules probe's outcome: the server's mod load order and description,
/// or `None` when it never answered.
type RulesAnswer = (ServerKey, Option<(Vec<ServerMod>, String)>);

/// A2S_INFO over the freshest addresses plus a rotating slice of the ones
/// that have never answered anybody — `addresses` is ordered by sighting, so
/// on its own it would re-probe the same head of the table forever.
pub async fn info(
    cfg: &Config,
    prober: &Prober,
    registry: &Arc<Registry>,
    writer: &Writer,
) -> Result<InfoStats, SweepError> {
    let started = Instant::now();
    let batch = cfg.info_batch;
    let registry = Arc::clone(registry);
    let targets: Vec<ServerKey> = tokio::task::spawn_blocking(move || {
        let reader = registry.reader()?;
        let fresh = reader.addresses(batch)?;
        let stale = reader.unresolved(batch / 4, RESOLVE_RETRY_AFTER_SECS)?;
        let mut seen: HashSet<ServerKey> = HashSet::with_capacity(fresh.len() + stale.len());
        let mut keys = Vec::with_capacity(fresh.len() + stale.len());
        for key in fresh.into_iter().map(|(key, _)| key).chain(stale) {
            if seen.insert(key) {
                keys.push(key);
            }
        }
        Ok::<_, RegistryError>(keys)
    })
    .await
    .map_err(|e| SweepError::Task(e.to_string()))??;

    if targets.is_empty() {
        return Ok(InfoStats::default());
    }

    // Stamped before the probe, not after, so an address that never answers
    // still advances and the rotation keeps moving.
    for chunk in targets.chunks(KEY_BATCH) {
        let _ = writer.mark_probe_attempt(chunk.to_vec()).await;
    }

    let addrs: Vec<SocketAddr> = targets
        .iter()
        .map(|key| SocketAddr::from((key.ip, key.query_port)))
        .collect();
    let mut stats = InfoStats {
        probed: addrs.len(),
        ..InfoStats::default()
    };

    let mut rx = prober.refresh(addrs);
    let mut batch_rows: Vec<ServerRow> = Vec::with_capacity(WRITE_BATCH);
    let mut online: Vec<ServerKey> = Vec::new();
    let mut offline: Vec<ServerKey> = Vec::new();

    while let Some(outcome) = rx.recv().await {
        let SocketAddr::V4(sock) = outcome.addr else {
            continue;
        };
        let key = ServerKey {
            ip: *sock.ip(),
            query_port: sock.port(),
        };
        let Ok(info) = outcome.result else {
            stats.failed += 1;
            offline.push(key);
            continue;
        };
        stats.answered += 1;
        online.push(key);
        batch_rows.push(ServerRow {
            key,
            game_port: info.game_port.unwrap_or(0),
            name: info.name,
            map: info.map,
            players: i32::from(info.players),
            max_players: i32::from(info.max_players),
            bots: i32::from(info.bots),
            ping_ms: outcome
                .rtt
                .map(|d| d.as_millis().min(i32::MAX as u128) as i32)
                .unwrap_or(0),
            locked: info.visibility != 0,
            vac: info.vac != 0,
            version: Some(info.version),
            keywords: info.keywords,
            description: None,
            // Owned exclusively by `upsert_server_mods`.
            mod_count: None,
            last_played: None,
            responded: true,
            country_code: None,
        });
        if batch_rows.len() >= WRITE_BATCH {
            let rows = std::mem::take(&mut batch_rows);
            let _ = writer.upsert_servers(rows).await;
            batch_rows.reserve(WRITE_BATCH);
        }
    }

    if !batch_rows.is_empty() {
        let _ = writer.upsert_servers(batch_rows).await;
    }
    for chunk in online.chunks(KEY_BATCH) {
        let _ = writer.set_online(chunk.to_vec(), true).await;
    }

    let total = stats.answered + stats.failed;
    let failure_rate = if total > 0 {
        stats.failed as f64 / total as f64
    } else {
        0.0
    };
    stats.offline_marks_suppressed = total >= MIN_BATCH_FOR_OFFLINE_CORROBORATION
        && failure_rate > OFFLINE_CORROBORATION_THRESHOLD;
    if !stats.offline_marks_suppressed {
        for chunk in offline.chunks(KEY_BATCH) {
            let _ = writer.set_online(chunk.to_vec(), false).await;
        }
    }

    stats.elapsed = started.elapsed();
    Ok(stats)
}

/// A2S_RULES over the servers whose mod list is missing or stale. Answers
/// carry the mod load order and the server description, which exist nowhere
/// else — not in the Steam list, not in A2S_INFO.
pub async fn rules(
    cfg: &Config,
    prober: &Prober,
    registry: &Arc<Registry>,
    writer: &Writer,
) -> Result<RulesStats, SweepError> {
    let started = Instant::now();
    let (limit, ttl) = (cfg.rules_batch, cfg.rules_ttl_secs);
    let registry = Arc::clone(registry);
    let backlog = tokio::task::spawn_blocking(move || {
        let reader = registry.reader()?;
        reader.rules_backlog(limit, ttl)
    })
    .await
    .map_err(|e| SweepError::Task(e.to_string()))??;

    if backlog.is_empty() {
        return Ok(RulesStats::default());
    }

    let mut stats = RulesStats {
        probed: backlog.len(),
        ..RulesStats::default()
    };
    let fanout = rules_fanout(prober);
    let mut queue = backlog.into_iter();
    let mut tasks: JoinSet<RulesAnswer> = JoinSet::new();
    let mut mods: Vec<(ServerKey, Vec<ServerMod>)> = Vec::with_capacity(WRITE_BATCH);
    let mut descriptions: Vec<ServerRow> = Vec::with_capacity(WRITE_BATCH);

    loop {
        while tasks.len() < fanout {
            let Some((key, _game_port)) = queue.next() else {
                break;
            };
            let prober = prober.clone();
            let addr = SocketAddr::from((key.ip, key.query_port));
            tasks.spawn(async move {
                match prober.rules_with_deadline(addr, RULES_DEADLINE).await {
                    Ok(payload) => (key, Some((payload.mods, payload.description))),
                    Err(_) => (key, None),
                }
            });
        }
        let Some(joined) = tasks.join_next().await else {
            break;
        };
        let Ok((key, answer)) = joined else { continue };
        let Some((server_mods, description)) = answer else {
            continue;
        };
        stats.answered += 1;
        stats.mods += server_mods.len();
        mods.push((key, server_mods));
        if !description.is_empty() {
            // `responded: false` on purpose: this row carries only a
            // description, and the writer's guards overwrite name/map/players
            // from any row that claims to have responded — with the empty
            // values of the fields this row doesn't know.
            descriptions.push(ServerRow {
                key,
                description: Some(description),
                ..ServerRow::default()
            });
        }
        if mods.len() >= WRITE_BATCH {
            flush_mods(writer, std::mem::take(&mut mods)).await;
        }
        if descriptions.len() >= WRITE_BATCH {
            let rows = std::mem::take(&mut descriptions);
            let _ = writer.upsert_servers(rows).await;
        }
    }

    flush_mods(writer, mods).await;
    if !descriptions.is_empty() {
        let _ = writer.upsert_servers(descriptions).await;
    }

    stats.elapsed = started.elapsed();
    Ok(stats)
}

async fn flush_mods(writer: &Writer, batch: Vec<(ServerKey, Vec<ServerMod>)>) {
    if batch.is_empty() {
        return;
    }
    if let Err(e) = writer.upsert_server_mods_bulk(batch).await {
        tracing::warn!(error = %e, "mod write batch failed");
    }
}
