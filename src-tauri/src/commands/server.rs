use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tauri::{Emitter, State};
use crate::state::AppState;
use tetra_core::classify::keywords::parse_keywords;
use tetra_net::{ProbeConfig, Prober};
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
    pub keywords: Option<String>,
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
        keywords: None,
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

    {
        let _guard = state.registry.lock().map_err(|e| e.to_string())?;
        if _guard.is_none() {
            return Err("Registry not initialized".into());
        }
    }

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        let registry = guard.as_ref().ok_or("Registry not initialized")?;
        registry.writer()
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
pub fn get_server_list(
    state: State<AppState>,
    filter_params: FilterParams,
    sort_params: SortParams,
) -> Result<Vec<Server32>, String> {
    let guard = state.registry.lock().map_err(|e| e.to_string())?;
    let registry = guard.as_ref().ok_or("Registry not initialized")?;
    let reader = registry.reader().map_err(|e| e.to_string())?;

    let filter = filter_from_params(filter_params);
    let (sort_key, sort_dir) = sort_from_params(&sort_params);

    let rows = reader
        .list(&filter, sort_key, sort_dir, sort_params.limit)
        .map_err(|e| e.to_string())?;

    Ok(rows.iter().map(to_server32).collect())
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
    addrs: Vec<SocketAddr>,
    writer: &tetra_registry::Writer,
    window: &tauri::Window,
    mark_offline: bool,
) -> InfoBatchResult {
    let prober = Prober::new(ProbeConfig::default());
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
        let key = ServerKey { ip: *addr.ip(), query_port: addr.port() };

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

        if info.keywords.as_deref().map(parse_keywords).is_some_and(|k| k.modded) {
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

    InfoBatchResult { refreshed, failed, modded }
}

/// Phase 2 of a refresh: A2S_RULES for whatever phase 1 found modded,
/// concurrently. Returns how many writes succeeded and, for each, the mod
/// list that came back — the caller needs that list to ask Steam about
/// pending updates without a second registry round trip.
async fn probe_rules(
    modded: Vec<(ServerKey, SocketAddr)>,
    writer: &tetra_registry::Writer,
) -> (usize, Vec<(ServerKey, Vec<tetra_core::a2s::dayz::ServerMod>)>) {
    let prober = Prober::new(ProbeConfig::default());
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
                    let ok = writer.upsert_server_mods(key, rules.mods.clone()).await.is_ok();
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
            .list(&filter, SortKey::RefreshPriority, SortDir::Desc, PROBE_WINDOW)
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

    let info = probe_info(addrs, &writer, &window, false).await;
    let (mods_updated, _mod_lists) = probe_rules(info.modded, &writer).await;

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
    let socket_addrs: Vec<SocketAddr> = addrs
        .iter()
        .map(|a| server_key(&a.addr, a.query_port).map(|k| SocketAddr::from((k.ip, k.query_port))))
        .collect::<Result<_, String>>()?;

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        let registry = guard.as_ref().ok_or("Registry not initialized")?;
        registry.writer()
    };

    let info = probe_info(socket_addrs, &writer, &window, true).await;
    let (mods_updated, mod_lists) = probe_rules(info.modded, &writer).await;

    // Phase 3: ask Steam whether any of the mods just re-declared need an
    // update. Best-effort — Steam not being connected, or the lookup
    // failing, just means the launcher stays silent on this rather than
    // failing the whole refresh.
    let steam = state.steam.lock().map_err(|e| e.to_string())?.as_ref().map(Arc::clone);
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
pub fn get_server_mods(
    state: State<AppState>,
    addr: String,
    query_port: u16,
) -> Result<Vec<ModEntry>, String> {
    let guard = state.registry.lock().map_err(|e| e.to_string())?;
    let registry = guard.as_ref().ok_or("Registry not initialized")?;
    let reader = registry.reader().map_err(|e| e.to_string())?;

    let mods = reader
        .mods_for(server_key(&addr, query_port)?)
        .map_err(|e| e.to_string())?;

    Ok(mods.into_iter().map(|m| ModEntry {
        workshop_id: m.workshop_id.to_string(),
        name: m.name,
    }).collect())
}

/// Get details for a single server.
#[tauri::command]
pub fn get_server_details(
    _state: State<AppState>,
    _addr: String,
    _query_port: u16,
) -> Result<Option<Server32>, String> {
    Ok(None)
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
pub fn get_server_counts(state: State<AppState>) -> Result<ServerCounts, String> {
    let guard = state.registry.lock().map_err(|e| e.to_string())?;
    let registry = guard.as_ref().ok_or("Registry not initialized")?;
    let reader = registry.reader().map_err(|e| e.to_string())?;

    let total = reader.count().map_err(|e| e.to_string())?;
    let populated: i64 = reader
        .raw()
        .query_row("SELECT COUNT(*) FROM servers WHERE players > 0", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;

    Ok(ServerCounts {
        total,
        populated: populated as usize,
    })
}

/// Get map list from registry.
#[tauri::command]
pub fn get_map_list(state: State<AppState>) -> Result<Vec<(String, String)>, String> {
    let guard = state.registry.lock().map_err(|e| e.to_string())?;
    let registry = guard.as_ref().ok_or("Registry not initialized")?;
    let reader = registry.reader().map_err(|e| e.to_string())?;
    reader.distinct_maps().map_err(|e| e.to_string())
}

// ── helpers ─────────────────────────────────────────────────────

/// Build a `ServerKey` from the bridge's `"IP:query_port"` string plus the
/// port the frontend sends alongside it. The port in the string is the same
/// value; `query_port` is taken as authoritative and the string is only read
/// for its IP.
fn server_key(addr: &str, query_port: u16) -> Result<ServerKey, String> {
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