use crate::state::AppState;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tauri::{Emitter, State};
use tetra_core::classify::keywords::parse_keywords;
use tetra_net::Prober;
use tetra_registry::filter::{ServerFilter, SortDir, SortKey};
use tetra_registry::rows::ServerKey;
use tetra_steam::to_server_row;

/// How many servers one refresh probes.
///
/// Independent of the table's display limit: this is backend-only work bounded
/// by `ProbeConfig::max_in_flight`, and it is what decides how many servers ever
/// get a `mod_count`. At the old value of 500 a server outside the top 500 by
/// player count was never rules-probed, so its mod column stayed blank forever
/// no matter how many times the user hit refresh.
const PROBE_WINDOW: usize = 5000;

/// Servers per registry write batch during a refresh.
const WRITE_BATCH: usize = 200;

/// Ceiling on one server's whole A2S_RULES retry chain.
const RULES_DEADLINE: std::time::Duration = std::time::Duration::from_secs(8);

/// Borrow the process-wide `Prober` from application state.
///
/// Every probing path must go through this. `probe_info` and `probe_rules` each
/// used to build their own `Prober::new(ProbeConfig::default())`, and a `Prober`
/// owns its concurrency semaphore — so each fresh one came with a *full*
/// `MAX_IN_FLIGHT` budget of its own. Two overlapping refreshes therefore opened
/// up to 2048 sockets between them, and a refresh overlapping a launch's rules
/// query added more still, despite `MAX_IN_FLIGHT` documenting itself as "the
/// one tuning constant for transport concurrency". Sharing the single instance
/// created in `setup` is what makes that true.
fn prober(state: &AppState) -> Result<Prober, String> {
    let guard = state.prober.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().ok_or("Prober not initialized")?.clone())
}

/// Open a read connection, releasing the state lock before returning.
///
/// The tight scope is load-bearing twice over. `state.registry` is a
/// `std::sync::Mutex`, whose guard is not `Send`, so an `async` command that
/// held one across an `.await` would not compile. And a `Reader` owns its own
/// SQLite connection, so handing it to a blocking task keeps no lock at all —
/// the writer thread stays free to commit while the query runs.
fn reader(state: &AppState) -> Result<tetra_registry::Reader, String> {
    let guard = state.registry.lock().map_err(|e| e.to_string())?;
    guard
        .as_ref()
        .ok_or("Registry not initialized")?
        .reader()
        .map_err(|e| e.to_string())
}

/// Run a blocking registry read off the main thread.
///
/// **Every query command must go through this.** A non-`async` Tauri command
/// runs on the main thread and the IPC response is dispatched synchronously, so
/// the SQLite work happened between paint frames: `get_server_list` alone builds
/// a filtered query, walks up to `SortParams::limit` (5000) rows and allocates a
/// `Server32` for each, and it re-runs on every filter edit, sort click and
/// throttled reload during discovery. That was the window freezing while the
/// table repopulated.
async fn blocking_read<T, F>(state: &AppState, work: F) -> Result<T, String>
where
    F: FnOnce(tetra_registry::Reader) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let reader = reader(state)?;
    tokio::task::spawn_blocking(move || work(reader))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

/// Serializable server type for the Tauri bridge (32-bit safe).
#[derive(serde::Serialize, Clone)]
pub struct Server32 {
    pub addr: String,
    pub game_port: u32,
    pub query_port: u32,
    pub name: String,
    // No raw `map`: `ServerListRow` only carries the display name, and having a
    // `map` field that silently held the display string invited exactly the
    // mix-up that made `display_name` run twice.
    pub map_display: String,
    pub players: i32,
    pub max_players: i32,
    pub ping: Option<i32>,
    pub locked: bool,
    pub vac: bool,
    pub version: String,
    // No `keywords`: it was serialised as a permanent `null` (the row's raw
    // keyword string is never read back out), and the frontend type declared it
    // as `string | null`, which invited a reader that could only ever get null.
    // Everything derived from keywords is already on the row as a flag.
    pub in_game_time: Option<String>,
    pub mod_count: Option<i32>,
    pub country_code: Option<String>,
    pub last_played: Option<i64>,
    pub favourite: bool,
    pub official: bool,
    pub modded: bool,
    pub first_person: bool,
    pub battleye: bool,
    /// Whether the last targeted refresh that reached for this server got an
    /// answer. See the `online` column comment in `tetra_registry::schema`.
    pub online: bool,
}

#[derive(serde::Deserialize)]
pub struct FilterParams {
    pub maps: Vec<String>,
    pub countries: Vec<String>,
    pub hide_empty: bool,
    pub hide_full: bool,
    pub hide_locked: bool,
    pub max_ping: Option<i32>,
    pub search: Option<String>,
    pub favourites_only: bool,
    #[serde(default)]
    pub recent_only: bool,
    pub official: Option<bool>,
    pub modded: Option<bool>,
    pub first_person: Option<bool>,
    // Defaulted so a frontend that predates these still deserialises — and so
    // the omission means "show everything", never "hide silently".
    #[serde(default)]
    pub hide_unnamed: bool,
    #[serde(default)]
    pub hide_placeholder: bool,
    #[serde(default)]
    pub english_names: Option<bool>,
}

#[derive(serde::Deserialize)]
pub struct SortParams {
    pub sort_key: String,
    pub sort_dir: String,
    pub limit: usize,
}

/// Map a registry row onto the bridge type.
///
/// Takes the row itself rather than seventeen positional arguments: the old
/// signature had `map_raw` and `map_display` as adjacent `&str` parameters and
/// the call site passed `map_display` into both, so `display_name` ran twice.
/// The classification flags come straight off the row — they were derived from
/// `keywords` once at write time and the filter SQL matches on those same
/// columns, so re-deriving them here could only ever disagree.
fn to_server32(r: &tetra_registry::filter::ServerListRow) -> Server32 {
    Server32 {
        addr: format!("{}:{}", r.key.ip, r.key.query_port),
        game_port: r.game_port as u32,
        query_port: r.key.query_port as u32,
        name: r.name.clone(),
        map_display: r.map_display.clone(),
        players: r.players,
        max_players: r.max_players,
        ping: (r.ping_ms > 0).then_some(r.ping_ms),
        locked: r.locked,
        vac: r.vac,
        version: r.version.clone().unwrap_or_default(),
        in_game_time: r.in_game_time.clone(),
        mod_count: r.mod_count,
        country_code: r.country_code.clone(),
        last_played: r.last_played,
        favourite: r.favourite,
        official: r.official,
        modded: r.modded,
        first_person: r.first_person,
        battleye: r.battleye,
        online: r.online,
    }
}

/// Discover servers through Steam and store them in the registry.
#[tauri::command]
pub async fn discover_servers(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<(), String> {
    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        Arc::clone(guard.as_ref().ok_or("Steam not initialized")?)
    };

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Registry not initialized")?.writer()
    };

    // Steam takes tens of seconds to walk the full internet list, delivering
    // one server at a time. Consuming it as a stream means rows land in the
    // registry — and therefore on screen — from the first flush onward, instead
    // of the table sitting empty until the whole request completes.
    //
    // The channel is `std::sync::mpsc` fed from the (blocking) Steam thread, so
    // the receive loop runs on a blocking task and hands batches back here.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<tetra_steam::GameServerRow>>(16);

    let pump = tokio::task::spawn_blocking(move || {
        let mut filters = tetra_steam::Filters::new();
        filters.insert("empty".into(), "1".into());

        let chunks = steam
            .internet_list_stream(&filters)
            .map_err(|e| format!("Steam discovery failed: {e}"))?;

        for chunk in chunks {
            match chunk {
                tetra_steam::StreamChunk::Rows(rows) => {
                    if tx.blocking_send(rows).is_err() {
                        break;
                    }
                }
                tetra_steam::StreamChunk::Done(result) => {
                    return result.map_err(|e| format!("Steam discovery failed: {e}"));
                }
            }
        }
        Ok::<(), String>(())
    });

    let mut found = 0usize;
    while let Some(rows) = rx.recv().await {
        // No dedup pass: the registry is keyed on (ip, query_port) and the
        // upsert is idempotent, so a repeated row is a no-op write.
        let server_rows: Vec<tetra_registry::rows::ServerRow> =
            rows.iter().map(to_server_row).collect();
        found += server_rows.len();

        writer
            .upsert_servers(server_rows)
            .await
            .map_err(|e| format!("Registry write error: {e}"))?;

        let _ = window.emit(
            "discovery-progress",
            serde_json::json!({ "tier": 1, "found": found }),
        );
    }

    pump.await.map_err(|e| format!("Task join error: {e}"))??;

    Ok(())
}

/// Query the SQLite registry for the filtered/sorted server list.
#[tauri::command]
pub async fn get_server_list(
    state: State<'_, AppState>,
    filter_params: FilterParams,
    sort_params: SortParams,
) -> Result<Vec<Server32>, String> {
    blocking_read(&state, move |reader| {
        let filter = filter_from_params(filter_params);
        let (sort_key, sort_dir) = sort_from_params(&sort_params);
        let rows = reader
            .list(&filter, sort_key, sort_dir, sort_params.limit)
            .map_err(|e| e.to_string())?;
        Ok(rows.iter().map(to_server32).collect())
    })
    .await
}

/// One server's A2S_INFO probe outcome, on the way into a registry write.
struct InfoBatchResult {
    refreshed: usize,
    failed: usize,
    /// Servers that answered *and* whose keywords declare mods. Only these are
    /// worth an A2S_RULES probe — rules is the expensive query (a
    /// multi-fragment response that must reassemble intact) and on this
    /// dataset ~89% of servers declare mods, so probing the rest is wasted
    /// budget.
    modded: Vec<(ServerKey, SocketAddr)>,
}

/// Phase 1 of a refresh: A2S_INFO every address, writing results in batches.
///
/// `mark_offline` controls whether a probe that never answered flips that
/// server's `online` flag. A bulk refresh (`refresh_servers`) leaves it
/// `false` — its probe window doesn't necessarily cover the whole registry,
/// so a miss there says nothing about whether the server is actually down.
/// The targeted refresh (`refresh_visible_servers`) passes `true`: every
/// address it's given is one the user is looking at right now, so a miss is
/// exactly the "did this go offline" signal the UI wants.
async fn probe_info(
    prober: &Prober,
    addrs: Vec<SocketAddr>,
    writer: &tetra_registry::Writer,
    window: &tauri::Window,
    mark_offline: bool,
) -> InfoBatchResult {
    let mut rx = prober.refresh(addrs);

    let mut refreshed = 0usize;
    let mut failed = 0usize;
    let mut modded: Vec<(ServerKey, SocketAddr)> = Vec::new();
    let mut online_keys: Vec<ServerKey> = Vec::new();
    let mut offline_keys: Vec<ServerKey> = Vec::new();

    // One `upsert_servers(vec![single])` per server means one channel
    // round-trip and one SQLite transaction each; batching cuts both by
    // ~`WRITE_BATCH`x over a refresh of this size.
    let mut batch: Vec<tetra_registry::rows::ServerRow> = Vec::with_capacity(WRITE_BATCH);

    while let Some(outcome) = rx.recv().await {
        let addr = match outcome.addr {
            SocketAddr::V4(v4) => v4,
            SocketAddr::V6(_) => continue,
        };
        let key = ServerKey {
            ip: *addr.ip(),
            query_port: addr.port(),
        };

        let info = match outcome.result {
            Ok(info) => info,
            Err(_) => {
                failed += 1;
                if mark_offline {
                    offline_keys.push(key);
                }
                continue;
            }
        };
        refreshed += 1;
        online_keys.push(key);

        if info
            .keywords
            .as_deref()
            .map(parse_keywords)
            .is_some_and(|k| k.modded)
        {
            modded.push((key, outcome.addr));
        }

        batch.push(tetra_registry::rows::ServerRow {
            key,
            game_port: info.game_port.unwrap_or(0),
            name: info.name,
            map: info.map,
            players: info.players as i32,
            max_players: info.max_players as i32,
            bots: info.bots as i32,
            ping_ms: outcome
                .rtt
                .map(|d| d.as_millis().min(i32::MAX as u128) as i32)
                .unwrap_or(0),
            locked: info.visibility != 0,
            vac: info.vac != 0,
            version: Some(info.version),
            keywords: info.keywords,
            description: None,
            // `mod_count` is owned exclusively by `upsert_server_mods`.
            // Never set it from here or the value gets clobbered with None's
            // COALESCE fallback on every info refresh.
            mod_count: None,
            last_played: None,
            responded: true,
            country_code: None,
        });

        if batch.len() >= WRITE_BATCH {
            let _ = writer.upsert_servers(std::mem::take(&mut batch)).await;
            let _ = window.emit("server-refreshed", serde_json::json!({ "phase": "info" }));
            batch.reserve(WRITE_BATCH);
        }
    }

    if !batch.is_empty() {
        let _ = writer.upsert_servers(batch).await;
    }
    if !online_keys.is_empty() {
        let _ = writer.set_online(online_keys, true).await;
    }
    if !offline_keys.is_empty() {
        let _ = writer.set_online(offline_keys, false).await;
    }
    let _ = window.emit("server-refreshed", serde_json::json!({ "phase": "info" }));

    InfoBatchResult {
        refreshed,
        failed,
        modded,
    }
}

/// Phase 2 of a refresh: A2S_RULES for whatever phase 1 found modded,
/// concurrently. Returns how many writes succeeded and, for each, the mod
/// list that came back — the caller needs that list to ask Steam about
/// pending updates without a second registry round trip.
async fn probe_rules(
    prober: &Prober,
    modded: Vec<(ServerKey, SocketAddr)>,
    writer: &tetra_registry::Writer,
) -> (
    usize,
    Vec<(ServerKey, Vec<tetra_core::a2s::dayz::ServerMod>)>,
) {
    let mut rules_tasks = Vec::with_capacity(modded.len());

    for (key, addr) in modded {
        let prober = prober.clone();
        let writer = writer.clone();
        rules_tasks.push(tokio::spawn(async move {
            // A whole refresh must not be held hostage by a handful of servers
            // that accept the query and then trickle fragments. `Prober::rules`
            // already bounds each attempt, but not the retry chain as a whole.
            let probe = tokio::time::timeout(RULES_DEADLINE, prober.rules(addr));
            match probe.await {
                // Writing an empty mod list is deliberate: it records
                // "asked, declared nothing" as mod_count = 0, which the UI
                // shows differently from never-probed (NULL).
                Ok(Ok(rules)) => {
                    let ok = writer
                        .upsert_server_mods(key, rules.mods.clone())
                        .await
                        .is_ok();
                    (ok, Some((key, rules.mods)))
                }
                _ => (false, None),
            }
        }));
    }

    let mut mods_updated = 0usize;
    let mut mod_lists = Vec::new();
    for task in rules_tasks {
        if let Ok((ok, entry)) = task.await {
            if ok {
                mods_updated += 1;
            }
            if let Some(pair) = entry {
                mod_lists.push(pair);
            }
        }
    }

    (mods_updated, mod_lists)
}

/// A2S-refresh servers using the active frontend filter.
///
/// This is the *bulk* refresh — it walks up to `PROBE_WINDOW` servers picked
/// by refresh priority, independent of what's currently on screen. It backs
/// the initial post-discovery load and the DISCOVER button, both of which run
/// before the frontend has any server list to be "visible" against. The
/// REFRESH button instead calls `refresh_visible_servers`.
#[tauri::command]
pub async fn refresh_servers(
    state: State<'_, AppState>,
    window: tauri::Window,
    filter_params: Option<FilterParams>,
) -> Result<(), String> {
    let filter = filter_params.map(filter_from_params).unwrap_or_default();

    let addrs = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        let registry = guard.as_ref().ok_or("Registry not initialized")?;

        let reader = registry.reader().map_err(|e| e.to_string())?;
        let rows = reader
            .list(
                &filter,
                SortKey::RefreshPriority,
                SortDir::Desc,
                PROBE_WINDOW,
            )
            .map_err(|e| e.to_string())?;

        rows.iter()
            .map(|r| SocketAddr::from((r.key.ip, r.key.query_port)))
            .collect::<Vec<_>>()
    };

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        let registry = guard.as_ref().ok_or("Registry not initialized")?;
        registry.writer()
    };

    let prober = prober(&state)?;
    let info = probe_info(&prober, addrs, &writer, &window, false).await;
    let (mods_updated, _mod_lists) = probe_rules(&prober, info.modded, &writer).await;

    let _ = window.emit(
        "refresh-complete",
        serde_json::json!({ "ok": info.refreshed, "failed": info.failed, "mods_updated": mods_updated }),
    );
    Ok(())
}

/// One server the frontend wants re-probed, identified the same way the
/// bridge already identifies one for `toggle_favourite` / `get_server_mods`.
#[derive(serde::Deserialize)]
pub struct AddrPort {
    pub addr: String,
    pub query_port: u16,
}

/// Whether a server's declared mods have a Steam update pending.
#[derive(serde::Serialize, Clone)]
pub struct ModsPendingEntry {
    pub addr: String,
    pub query_port: u16,
    pub pending: bool,
}

/// A2S-refresh exactly the servers the frontend passes in — what's actually
/// on screen, per `rowVirtualizer.getVirtualItems()` — rather than
/// re-querying the registry for a broad, possibly out-of-sync window. This is
/// what the REFRESH button calls.
///
/// Unlike `refresh_servers`, a probe that gets no answer here does mean
/// something: every address came from a row the user can currently see, so a
/// miss is written as `online = false` and the row can render OFFLINE.
///
/// Also re-asks Steam whether any declared mod has an update pending, for
/// whatever came back modded — the A2S_RULES pass alone only tells you the
/// server's mod *list*, not whether Steam's copy is stale.
#[tauri::command]
pub async fn refresh_visible_servers(
    state: State<'_, AppState>,
    window: tauri::Window,
    addrs: Vec<AddrPort>,
) -> Result<(), String> {
    // Unparseable entries are skipped, not fatal. Collecting into a `Result`
    // meant one malformed address failed the whole click — the user pressed
    // REFRESH and nothing on screen updated, with an error naming an address
    // they never typed.
    let socket_addrs: Vec<SocketAddr> = addrs
        .iter()
        .filter_map(|a| server_key(&a.addr, a.query_port).ok())
        .map(|k| SocketAddr::from((k.ip, k.query_port)))
        .collect();
    if socket_addrs.is_empty() {
        return Ok(());
    }

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        let registry = guard.as_ref().ok_or("Registry not initialized")?;
        registry.writer()
    };

    let prober = prober(&state)?;
    let info = probe_info(&prober, socket_addrs, &writer, &window, true).await;
    let (mods_updated, mod_lists) = probe_rules(&prober, info.modded, &writer).await;

    // Phase 3: ask Steam whether any of the mods just re-declared need an
    // update. Best-effort — Steam not being connected, or the lookup
    // failing, just means the launcher stays silent on this rather than
    // failing the whole refresh.
    let steam = state
        .steam
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(Arc::clone);
    if let (Some(steam), false) = (steam, mod_lists.is_empty()) {
        let mut ids: Vec<u64> = mod_lists
            .iter()
            .flat_map(|(_, mods)| mods.iter().map(|m| m.workshop_id))
            .collect();
        ids.sort_unstable();
        ids.dedup();

        let states = tokio::task::spawn_blocking(move || steam.mod_states(&ids)).await;
        if let Ok(Ok(states)) = states {
            let state_map: std::collections::HashMap<u64, tetra_steam::workshop::ModState> =
                states.into_iter().collect();

            let pending: Vec<ModsPendingEntry> = mod_lists
                .iter()
                .map(|(key, mods)| {
                    let has_pending = mods.iter().any(|m| {
                        matches!(
                            state_map.get(&m.workshop_id),
                            Some(tetra_steam::workshop::ModState::NeedsUpdate)
                                | Some(tetra_steam::workshop::ModState::Downloading)
                        )
                    });
                    ModsPendingEntry {
                        addr: format!("{}:{}", key.ip, key.query_port),
                        query_port: key.query_port,
                        pending: has_pending,
                    }
                })
                .collect();

            let _ = window.emit("mods-pending", pending);
        }
    }

    let _ = window.emit(
        "refresh-complete",
        serde_json::json!({ "ok": info.refreshed, "failed": info.failed, "mods_updated": mods_updated }),
    );
    Ok(())
}

/// Get mods for a single server.
#[derive(serde::Serialize, Clone)]
pub struct ModEntry {
    pub workshop_id: String,
    pub name: String,
}

#[tauri::command]
pub async fn get_server_mods(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<Vec<ModEntry>, String> {
    let key = server_key(&addr, query_port)?;
    blocking_read(&state, move |reader| {
        let mods = reader.mods_for(key).map_err(|e| e.to_string())?;
        Ok(mods
            .into_iter()
            .map(|m| ModEntry {
                // Stringified: workshop ids exceed JS's safe integer range.
                workshop_id: m.workshop_id.to_string(),
                name: m.name,
            })
            .collect())
    })
    .await
}

/// Set a server's favourite flag, persisted in the registry.
#[tauri::command]
pub async fn toggle_favourite(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
    favourite: bool,
) -> Result<(), String> {
    let key = server_key(&addr, query_port)?;
    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Registry not initialized")?.writer()
    };
    writer
        .set_favourite(key, favourite)
        .await
        .map_err(|e| e.to_string())
}

/// Registry counts for the footer.
#[derive(serde::Serialize)]
pub struct ServerCounts {
    pub total: usize,
    pub populated: usize,
}

#[tauri::command]
pub async fn get_server_counts(state: State<'_, AppState>) -> Result<ServerCounts, String> {
    blocking_read(&state, |reader| {
        let (total, populated) = reader.counts().map_err(|e| e.to_string())?;
        Ok(ServerCounts { total, populated })
    })
    .await
}

/// Whether the registry fell back to in-memory storage at startup.
///
/// `true` means the app works but forgets everything on exit — see the fallback
/// in `lib.rs`'s setup. Read once at startup so the UI can warn; previously this
/// only ever reached an `eprintln!` nobody sees in a windowed build.
#[tauri::command]
pub fn registry_degraded(state: State<AppState>) -> Result<bool, String> {
    state
        .registry_degraded
        .lock()
        .map(|flag| *flag)
        .map_err(|e| e.to_string())
}

/// Get map list from registry.
#[tauri::command]
pub async fn get_map_list(state: State<'_, AppState>) -> Result<Vec<(String, String)>, String> {
    blocking_read(&state, |reader| {
        reader.distinct_maps().map_err(|e| e.to_string())
    })
    .await
}

// ── helpers ─────────────────────────────────────────────────────

/// Build a `ServerKey` from the bridge's `"IP:query_port"` string plus the
/// port the frontend sends alongside it. The port in the string is the same
/// value; `query_port` is taken as authoritative and the string is only read
/// for its IP.
pub(crate) fn server_key(addr: &str, query_port: u16) -> Result<ServerKey, String> {
    let ip: Ipv4Addr = addr
        .split(':')
        .next()
        .ok_or_else(|| format!("Invalid address: {addr}"))?
        .parse()
        .map_err(|_| format!("Invalid IP in address: {addr}"))?;
    Ok(ServerKey { ip, query_port })
}

fn filter_from_params(p: FilterParams) -> ServerFilter {
    ServerFilter {
        maps: p.maps,
        countries: p.countries,
        hide_empty: p.hide_empty,
        hide_full: p.hide_full,
        hide_locked: p.hide_locked,
        unresponsive_after_secs: None,
        max_ping_ms: p.max_ping,
        search: p.search,
        favourites_only: p.favourites_only,
        recent_only: p.recent_only,
        official: p.official,
        modded: p.modded,
        first_person: p.first_person,
        hide_unnamed: p.hide_unnamed,
        hide_placeholder: p.hide_placeholder,
        english_names: p.english_names,
    }
}

fn sort_from_params(p: &SortParams) -> (SortKey, SortDir) {
    let key = match p.sort_key.as_str() {
        "players" => SortKey::Players,
        "ping" => SortKey::Ping,
        "mod_count" => SortKey::ModCount,
        "name" => SortKey::Name,
        "map" => SortKey::Map,
        "last_played" => SortKey::LastPlayed,
        _ => SortKey::Players,
    };
    let dir = match p.sort_dir.as_str() {
        "asc" => SortDir::Asc,
        _ => SortDir::Desc,
    };
    (key, dir)
}

#[cfg(test)]
mod tests {
    use super::server_key;

    /// The wire convention, pinned because getting it wrong is silent until a
    /// click fails. The frontend sends `addr` as `"IP:query_port"` *and* sends
    /// `query_port` separately, so a caller that appends the port again builds
    /// `"1.2.3.4:2303:2303"` — which is what broke VERIFY & JOIN with "invalid
    /// socket address syntax". Everything that needs a socket address for a
    /// server goes through here rather than formatting one itself.
    #[test]
    fn an_address_already_carrying_a_port_is_not_given_a_second_one() {
        let key = server_key("172.111.51.137:27022", 27022).expect("should parse");
        assert_eq!(key.ip.to_string(), "172.111.51.137");
        assert_eq!(key.query_port, 27022);

        let socket = std::net::SocketAddr::from((key.ip, key.query_port));
        assert_eq!(socket.to_string(), "172.111.51.137:27022");
    }

    /// `query_port` is authoritative; the port inside the string is ignored
    /// rather than trusted, so the two disagreeing cannot produce a key that
    /// points at a port nothing is listening on.
    #[test]
    fn the_separate_query_port_wins_over_the_one_in_the_string() {
        let key = server_key("1.2.3.4:9999", 2303).expect("should parse");
        assert_eq!(key.query_port, 2303);
    }

    #[test]
    fn a_malformed_address_is_rejected_rather_than_guessed_at() {
        assert!(server_key("not-an-ip:2303", 2303).is_err());
        assert!(server_key("", 2303).is_err());
    }
}
