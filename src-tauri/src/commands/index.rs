//! The backend server index: pulls a `tetra_index` snapshot into the registry
//! instead of spending ~17 minutes on a client-side Steam pass.
//!
//! Every failure path here is silent and non-fatal by design — the index is an
//! accelerator, and `discover_servers` runs its Steam pass whenever this module
//! declines.

use crate::state::AppState;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{Emitter, State};
use tetra_core::a2s::dayz::ServerMod;
use tetra_index::{Fetch, Health, IndexClient, ServerEntry, Snapshot, HEALTH_BACKOFF_SECS};
use tetra_registry::{ServerKey, ServerRow, Writer};

/// How stale the backend's snapshot may be and still be preferred over asking
/// Steam ourselves. The backend hot-pulls every 60s and full-pulls every 15
/// minutes, so anything older than one full pull means its crawler has stopped.
const MAX_SNAPSHOT_AGE_SECS: i64 = 15 * 60;

/// Rows per `upsert_servers` call. One transaction each, so this trades commit
/// count against how long a batch holds the writer thread.
const SERVER_BATCH: usize = 4000;

/// Servers per `upsert_server_mods_bulk` call. Smaller than [`SERVER_BATCH`]
/// because each entry carries a whole mod list.
const MODS_BATCH: usize = 500;

/// Which source served the list the browser is currently showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ListSource {
    Index,
    Steam,
}

/// Per-session index state. All in memory: a cold start paying for the full
/// snapshot costs seconds, and persisting an `ETag` across runs would risk a
/// 304 against a registry that has since been deleted.
#[derive(Default)]
pub struct IndexSession {
    /// `ETag` of the last full snapshot, for a conditional re-fetch.
    pub etag: Option<String>,
    /// Cursor of the last ingested body; `Some` switches this session to deltas.
    pub cursor: Option<i64>,
    /// Consecutive failures, indexing [`HEALTH_BACKOFF_SECS`].
    pub failures: usize,
    /// Earliest instant the backend may be contacted again.
    pub retry_at: Option<Instant>,
    /// Which source last served a complete list.
    pub last_source: Option<ListSource>,
}

/// What the frontend's source indicator reads.
#[tauri::command]
pub fn server_list_source(state: State<AppState>) -> Option<ListSource> {
    state.index.lock().ok().and_then(|s| s.last_source)
}

/// Record that the Steam pass served the list, and tell the frontend.
pub fn record_steam_source(state: &AppState, window: &tauri::Window, servers: usize, ms: u128) {
    if let Ok(mut session) = state.index.lock() {
        session.last_source = Some(ListSource::Steam);
    }
    emit_source(window, ListSource::Steam, servers, ms);
}

fn emit_source(window: &tauri::Window, source: ListSource, servers: usize, ms: u128) {
    let _ = window.emit(
        "discovery-source",
        serde_json::json!({ "source": source, "servers": servers, "ms": ms }),
    );
}

/// Try to serve this discovery pass from the backend index.
///
/// `Some(n)` means the list is current and the caller must not run its Steam
/// pass; `None` means fall through to Steam, for any reason at all.
pub async fn try_index(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    writer: &Writer,
    window: &tauri::Window,
) -> Option<usize> {
    // The index address is baked in at build time by the release pipeline
    // (`TETRA_INDEX_URL`); a build without it simply never contacts one, and
    // every discovery falls through to the Steam pass below.
    if INDEX_URL.is_empty() {
        return None;
    }
    let url = INDEX_URL;

    if let Some(retry_at) = state.index.lock().ok().and_then(|s| s.retry_at) {
        if Instant::now() < retry_at {
            crate::log::log_line_verbose(
                app,
                "index",
                "try_index: still inside the health backoff, using Steam",
            );
            return None;
        }
    }

    let started = Instant::now();
    let client = match IndexClient::new(&url, USER_AGENT) {
        Ok(c) => c,
        Err(e) => return decline(app, state, &format!("{url} is unusable: {e}")),
    };

    let health = match client.health().await {
        Ok(h) => h,
        Err(e) => return decline(app, state, &format!("health check failed: {e}")),
    };
    if !health.is_fresh(now(), MAX_SNAPSHOT_AGE_SECS) {
        return decline(app, state, &stale_reason(&health));
    }

    // A session that has already ingested one body asks for the delta; the
    // backend answers with a full snapshot anyway when the cursor is too old.
    let (etag, cursor) = match state.index.lock() {
        Ok(s) => (s.etag.clone(), s.cursor),
        Err(e) => return decline(app, state, &format!("index state poisoned: {e}")),
    };
    let was_full_snapshot = cursor.is_none();
    let fetched = match cursor {
        Some(cursor) => client.delta(cursor).await,
        None => client.snapshot(etag.as_deref()).await,
    };

    let (etag, snapshot) = match fetched {
        Ok(Fetch::NotModified) => {
            succeed(state, window, 0, started.elapsed().as_millis());
            crate::log::log_line(app, "index", "try_index: snapshot unchanged");
            return Some(0);
        }
        Ok(Fetch::Fresh { etag, body }) => (etag, body),
        Err(e) => return decline(app, state, &format!("fetch failed: {e}")),
    };

    let cursor = snapshot.cursor;
    let listed = snapshot.servers.len();
    let ingested = match ingest(
        writer,
        snapshot,
        |found| {
            let _ = window.emit(
                "discovery-progress",
                serde_json::json!({ "tier": 1, "found": found }),
            );
        },
        || state.shutting_down.load(Ordering::Relaxed),
    )
    .await
    {
        Ok(n) => n,
        Err(e) => return decline(app, state, &format!("ingest failed: {e}")),
    };

    if let Ok(mut session) = state.index.lock() {
        // The `ETag` belongs to the full snapshot endpoint only.
        if was_full_snapshot {
            session.etag = etag;
        }
        session.cursor = Some(cursor);
    }

    let ms = started.elapsed().as_millis();
    succeed(state, window, ingested.servers, ms);
    crate::log::log_line(
        app,
        "index",
        &format!(
            "try_index: {listed} listed, {} written ({} with mods, {} unparseable) in {ms}ms",
            ingested.servers, ingested.with_mods, ingested.skipped
        ),
    );
    Some(ingested.servers)
}

/// The backend's base URL, from the build. There is deliberately no runtime
/// setting: the launcher's backend is the release's backend, and repointing
/// it is a build decision.
const INDEX_URL: &str = match option_env!("TETRA_INDEX_URL") {
    Some(url) => url,
    None => "",
};

/// Identifies this build to the backend, so a misbehaving launcher version is
/// diagnosable from its access log.
const USER_AGENT: &str = concat!("tetra-launcher/", env!("CARGO_PKG_VERSION"));

/// Log why the index was skipped, arm the health backoff, and fall through to Steam.
fn decline(app: &tauri::AppHandle, state: &State<'_, AppState>, reason: &str) -> Option<usize> {
    crate::log::log_line(app, "index", &format!("try_index: {reason}; using Steam"));
    if let Ok(mut session) = state.index.lock() {
        let step = session.failures.min(HEALTH_BACKOFF_SECS.len() - 1);
        session.retry_at = Some(Instant::now() + Duration::from_secs(HEALTH_BACKOFF_SECS[step]));
        session.failures = session.failures.saturating_add(1);
    }
    None
}

fn succeed(state: &State<'_, AppState>, window: &tauri::Window, servers: usize, ms: u128) {
    if let Ok(mut session) = state.index.lock() {
        session.failures = 0;
        session.retry_at = None;
        session.last_source = Some(ListSource::Index);
    }
    emit_source(window, ListSource::Index, servers, ms);
}

fn stale_reason(health: &Health) -> String {
    match health.snapshot_generated_at {
        Some(t) => format!(
            "snapshot is {}s old (limit {MAX_SNAPSHOT_AGE_SECS}s)",
            now().saturating_sub(t)
        ),
        None => "backend has never built a snapshot".to_string(),
    }
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// What one ingest wrote.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Ingested {
    pub servers: usize,
    pub with_mods: usize,
    /// Entries dropped because their `addr` did not parse.
    pub skipped: usize,
}

/// Write a snapshot into the registry, in batches.
///
/// `progress` is called with the running row count after each batch — the
/// caller turns that into the `discovery-progress` event the splash reads —
/// and `cancelled` is checked at the same points so a shutdown stops mid-way.
pub async fn ingest<P, C>(
    writer: &Writer,
    snapshot: Snapshot,
    progress: P,
    cancelled: C,
) -> Result<Ingested, String>
where
    P: Fn(usize),
    C: Fn() -> bool,
{
    let Snapshot {
        mod_names,
        servers,
        removed,
        ..
    } = snapshot;

    let mut out = Ingested::default();
    let mut rows: Vec<ServerRow> = Vec::with_capacity(SERVER_BATCH.min(servers.len()));
    let mut mods: Vec<(ServerKey, Vec<ServerMod>)> = Vec::new();

    for entry in servers {
        let Some((row, mod_ids)) = to_row(entry) else {
            out.skipped += 1;
            continue;
        };
        // `None` means the backend never got an A2S_RULES answer, which must
        // leave a mod list this client probed itself alone.
        if let Some(ids) = mod_ids {
            mods.push((row.key, named_mods(ids, &mod_names)));
        }
        rows.push(row);

        if rows.len() >= SERVER_BATCH {
            // Mods reference their server row by foreign key, so the rows go first.
            out.servers += flush_rows(writer, &mut rows).await?;
            out.with_mods += flush_mods(writer, &mut mods).await?;
            progress(out.servers);
            if cancelled() {
                return Ok(out);
            }
        }
    }

    out.servers += flush_rows(writer, &mut rows).await?;
    out.with_mods += flush_mods(writer, &mut mods).await?;

    // Addresses the backend has dropped as spoofed or long dead. Marked
    // offline rather than deleted: this client may still be able to reach one,
    // and its favourite/recent history is the user's, not the backend's.
    let gone: Vec<ServerKey> = removed.iter().filter_map(|a| parse_key(a)).collect();
    if !gone.is_empty() {
        writer
            .set_online(gone, false)
            .await
            .map_err(|e| e.to_string())?;
    }

    progress(out.servers);
    Ok(out)
}

/// Resolve a declared load order against the snapshot's shared name table. A
/// name the backend never learned becomes the empty string, which is what the
/// mod tables already store for an unknown name.
fn named_mods(ids: Vec<u64>, names: &std::collections::HashMap<u64, String>) -> Vec<ServerMod> {
    ids.into_iter()
        .map(|workshop_id| ServerMod {
            workshop_id,
            name: names.get(&workshop_id).cloned().unwrap_or_default(),
        })
        .collect()
}

async fn flush_rows(writer: &Writer, rows: &mut Vec<ServerRow>) -> Result<usize, String> {
    if rows.is_empty() {
        return Ok(0);
    }
    writer
        .upsert_servers(std::mem::take(rows))
        .await
        .map_err(|e| e.to_string())
}

async fn flush_mods(
    writer: &Writer,
    mods: &mut Vec<(ServerKey, Vec<ServerMod>)>,
) -> Result<usize, String> {
    let total = mods.len();
    while !mods.is_empty() {
        let batch: Vec<_> = mods.drain(..MODS_BATCH.min(mods.len())).collect();
        writer
            .upsert_server_mods_bulk(batch)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(total)
}

/// `"ip:query_port"` — both halves required, IPv4 only, since that is what a
/// `ServerKey` is. A row whose address doesn't parse is dropped, never
/// defaulted: a `0.0.0.0` key would collide with every other bad address.
fn parse_key(addr: &str) -> Option<ServerKey> {
    match addr.parse::<SocketAddr>() {
        Ok(SocketAddr::V4(v4)) if !v4.ip().is_unspecified() && v4.port() != 0 => Some(ServerKey {
            ip: *v4.ip(),
            query_port: v4.port(),
        }),
        _ => None,
    }
}

/// A wire entry as a registry row, plus its declared mod ids. Consumes the
/// entry so its strings move rather than clone.
fn to_row(entry: ServerEntry) -> Option<(ServerRow, Option<Vec<u64>>)> {
    let key = parse_key(&entry.addr)?;
    let row = ServerRow {
        key,
        game_port: entry.game_port,
        name: entry.name,
        map: entry.map,
        players: entry.players,
        max_players: entry.max_players,
        bots: entry.bots,
        // Someone else's round trip says nothing about this user's; the
        // upsert refuses to overwrite a measured ping with this zero.
        ping_ms: 0,
        locked: entry.locked,
        vac: entry.vac,
        version: entry.version,
        keywords: entry.keywords,
        description: entry.description,
        mod_count: entry.mod_ids.as_ref().map(|m| m.len() as i32),
        last_played: None,
        responded: entry.last_responded.is_some(),
        // Filled in by the writer's GeoIP lookup.
        country_code: None,
    };
    Some((row, entry.mod_ids))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::net::Ipv4Addr;
    use tetra_registry::Registry;

    const KEY: ServerKey = ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, 10),
        query_port: 27016,
    };

    fn entry(addr: &str) -> ServerEntry {
        ServerEntry {
            addr: addr.to_string(),
            game_port: 2302,
            name: "Test Server".into(),
            map: "chernarusplus".into(),
            players: 3,
            max_players: 60,
            bots: 0,
            locked: false,
            vac: true,
            version: None,
            keywords: None,
            description: None,
            mod_ids: None,
            last_responded: Some(1_700_000_000),
        }
    }

    fn snapshot(servers: Vec<ServerEntry>, mod_names: HashMap<u64, String>) -> Snapshot {
        Snapshot {
            format_version: tetra_index::FORMAT_VERSION,
            generated_at: 1_700_000_000,
            cursor: 1_700_000_000,
            partial: false,
            mod_names,
            servers,
            removed: Vec::new(),
        }
    }

    async fn write(writer: &Writer, snapshot: Snapshot) -> Ingested {
        ingest(writer, snapshot, |_| {}, || false)
            .await
            .expect("ingest")
    }

    /// A `0.0.0.0` key would collide with every other unparseable address, so
    /// an entry whose `addr` doesn't parse must be dropped rather than defaulted.
    #[tokio::test]
    async fn an_entry_with_a_malformed_address_is_dropped_rather_than_written() {
        let registry = Registry::open_in_memory().expect("registry");
        let writer = registry.writer();

        let bad = [
            "not-an-ip:2303",
            "203.0.113.10",
            "",
            "[::1]:2303",
            "0.0.0.0:2303",
        ]
        .into_iter()
        .map(entry)
        .collect();
        let out = write(&writer, snapshot(bad, HashMap::new())).await;
        assert_eq!(out.servers, 0);
        assert_eq!(out.skipped, 5);

        let reader = registry.reader().expect("reader");
        assert_eq!(
            reader.counts().expect("counts").0,
            0,
            "nothing should be stored"
        );

        let out = write(
            &writer,
            snapshot(vec![entry("203.0.113.10:27016")], HashMap::new()),
        )
        .await;
        assert_eq!((out.servers, out.skipped), (1, 0));
        let row = reader.get(KEY).expect("get").expect("the good row");
        assert_eq!(row.key.ip.to_string(), "203.0.113.10");
        assert_eq!(row.key.query_port, 27016);
    }

    /// `mod_ids: None` means the backend never got an A2S_RULES answer, which
    /// must leave a list this client probed itself alone. `Some(vec![])` is the
    /// server saying it runs no mods, and does clear one.
    #[tokio::test]
    async fn absent_mod_ids_keep_a_probed_list_while_an_empty_list_clears_it() {
        let registry = Registry::open_in_memory().expect("registry");
        let writer = registry.writer();
        writer
            .upsert_servers(vec![ServerRow {
                key: KEY,
                name: "Test Server".into(),
                responded: true,
                ..Default::default()
            }])
            .await
            .expect("seed row");
        writer
            .upsert_server_mods(
                KEY,
                vec![ServerMod {
                    workshop_id: 1559212036,
                    name: "CF".into(),
                }],
            )
            .await
            .expect("seed mods");
        let reader = registry.reader().expect("reader");

        let out = write(
            &writer,
            snapshot(vec![entry("203.0.113.10:27016")], HashMap::new()),
        )
        .await;
        assert_eq!(out.with_mods, 0, "no mod data means no mod write at all");
        assert_eq!(
            reader.mods_for(KEY).expect("mods").len(),
            1,
            "a snapshot without mod data must leave the probed list alone"
        );

        let mut declares_none = entry("203.0.113.10:27016");
        declares_none.mod_ids = Some(Vec::new());
        let out = write(&writer, snapshot(vec![declares_none], HashMap::new())).await;
        assert_eq!(out.with_mods, 1);
        assert!(
            reader.mods_for(KEY).expect("mods").is_empty(),
            "an explicitly empty mod list must clear the stored one"
        );
    }

    /// Names are shared across the snapshot, so one the backend never learned
    /// has to become the empty string the mod tables already store.
    #[tokio::test]
    async fn a_mod_id_with_no_name_in_the_snapshot_is_stored_unnamed() {
        let registry = Registry::open_in_memory().expect("registry");
        let writer = registry.writer();

        let mut with_mods = entry("203.0.113.10:27016");
        with_mods.mod_ids = Some(vec![1559212036, 2116157322]);
        let names = HashMap::from([(1559212036u64, "CF".to_string())]);
        write(&writer, snapshot(vec![with_mods], names)).await;

        let stored = registry
            .reader()
            .expect("reader")
            .mods_for(KEY)
            .expect("mods");
        assert_eq!(stored.len(), 2, "load order is kept whole, named or not");
        assert_eq!(stored[0].name, "CF");
        assert_eq!(stored[1].name, "");
    }

    /// The index describes someone else's probe, so its rows carry no ping —
    /// and that zero must not erase one this client measured.
    #[tokio::test]
    async fn an_ingested_row_does_not_erase_a_locally_measured_ping() {
        let registry = Registry::open_in_memory().expect("registry");
        let writer = registry.writer();
        writer
            .upsert_servers(vec![ServerRow {
                key: KEY,
                name: "Test Server".into(),
                ping_ms: 42,
                responded: true,
                ..Default::default()
            }])
            .await
            .expect("seed row");

        write(
            &writer,
            snapshot(vec![entry("203.0.113.10:27016")], HashMap::new()),
        )
        .await;

        let row = registry
            .reader()
            .expect("reader")
            .get(KEY)
            .expect("get")
            .expect("row");
        assert_eq!(row.ping_ms, 42);
    }
}
