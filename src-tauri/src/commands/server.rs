use crate::state::AppState;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{Emitter, State};
use tetra_net::Prober;
use tetra_registry::filter::{ServerFilter, SortDir, SortKey};
use tetra_registry::rows::ServerKey;
use tetra_steam::to_server_row;

/// How many servers one refresh probes. Independent of the table's display
/// limit — see .ai-notes/src-tauri/src/commands/server.rs.md.
const PROBE_WINDOW: usize = 5000;

/// Servers per registry write batch during a refresh.
const WRITE_BATCH: usize = 200;

/// Ceiling on one server's whole A2S_RULES retry chain, measured from when a
/// permit is actually acquired — never from when the probe task was spawned.
const RULES_DEADLINE: std::time::Duration = std::time::Duration::from_secs(8);

/// Below this batch size, a failed A2S_INFO probe is written as `online =
/// false` unconditionally — too few data points to distinguish "down" from
/// "network hiccup" by failure ratio.
const MIN_BATCH_FOR_OFFLINE_CORROBORATION: usize = 8;

/// Share of a targeted batch that must fail before a miss is treated as "my
/// network", not "the server is down".
const OFFLINE_CORROBORATION_THRESHOLD: f64 = 0.4;

/// How many rules-probe tasks may be in flight at once during phase 2,
/// independent of how many candidates phase 1 handed over. Sized off the
/// prober's actual concurrency (with headroom) rather than a fixed guess.
fn rules_fanout(prober: &Prober) -> usize {
    prober
        .config()
        .max_in_flight
        .saturating_mul(2)
        .clamp(64, 1000)
}

/// Borrow the process-wide `Prober` from application state. Every probing
/// path must go through this — a fresh `Prober` owns its own concurrency
/// semaphore, so two overlapping refreshes each building their own used to
/// open far more sockets than `MAX_IN_FLIGHT` was meant to cap.
fn prober(state: &AppState) -> Result<Prober, String> {
    let guard = state.prober.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().ok_or("Prober not initialized")?.clone())
}

/// Open a read connection, releasing the state lock before returning. The
/// tight scope matters twice over: the `!Send` guard can't cross an
/// `.await`, and a `Reader` owning its own connection means handing it to a
/// blocking task keeps no lock at all.
pub(crate) fn reader(state: &AppState) -> Result<tetra_registry::Reader, String> {
    let guard = state.registry.lock().map_err(|e| e.to_string())?;
    guard
        .as_ref()
        .ok_or("Registry not initialized")?
        .reader()
        .map_err(|e| e.to_string())
}

/// The shared reader `blocking_read` uses, cloning the `Arc` so it can be
/// moved into `spawn_blocking` without borrowing `AppState` across it.
/// Lazily seeded on first call — every call used to open a brand-new
/// connection on the hottest path in the app.
fn reader_pool(state: &AppState) -> Result<Arc<std::sync::Mutex<tetra_registry::Reader>>, String> {
    let mut pool = state.server_reader.lock().map_err(|e| e.to_string())?;
    if let Some(r) = pool.as_ref() {
        return Ok(Arc::clone(r));
    }
    let fresh = reader(state)?;
    let shared = Arc::new(std::sync::Mutex::new(fresh));
    *pool = Some(Arc::clone(&shared));
    Ok(shared)
}

/// Run a blocking registry read off the main thread, against the pooled
/// reader connection. Every query command must go through this — a
/// non-`async` command's SQLite work would otherwise run inline between
/// paint frames, freezing the window while the table repopulates.
pub(crate) async fn blocking_read<T, F>(state: &AppState, work: F) -> Result<T, String>
where
    F: FnOnce(&tetra_registry::Reader) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let pool = reader_pool(state)?;
    tokio::task::spawn_blocking(move || {
        let reader = pool.lock().map_err(|e| e.to_string())?;
        work(&reader)
    })
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
    // No raw `map`: only the display name is carried, to avoid a silent name/display mix-up.
    pub map_display: String,
    pub players: i32,
    pub max_players: i32,
    pub ping: Option<i32>,
    pub locked: bool,
    pub vac: bool,
    pub version: String,
    // No `keywords`: everything derived from it is already on the row as a flag.
    pub in_game_time: Option<String>,
    pub mod_count: Option<i32>,
    pub country_code: Option<String>,
    pub last_played: Option<i64>,
    pub favourite: bool,
    pub official: bool,
    pub modded: bool,
    pub first_person: bool,
    pub battleye: bool,
    /// Whether the last targeted refresh that reached for this server got an answer.
    pub online: bool,
    /// Players waiting in the join queue. `0` = no queue, `null` = server didn't report one.
    pub queue: Option<i32>,
    /// Day/night time-acceleration multipliers, for the `Nx` shown next to the in-game time.
    pub day_multiplier: Option<f32>,
    pub night_multiplier: Option<f32>,
}

#[derive(serde::Deserialize)]
pub struct FilterParams {
    pub maps: Vec<String>,
    pub countries: Vec<String>,
    pub hide_empty: bool,
    pub hide_full: bool,
    pub hide_locked: bool,
    // Defaulted so an older frontend still deserialises, showing offline servers rather than hiding them.
    #[serde(default)]
    pub hide_offline: bool,
    pub max_ping: Option<i32>,
    pub search: Option<String>,
    pub favourites_only: bool,
    #[serde(default)]
    pub recent_only: bool,
    pub official: Option<bool>,
    pub modded: Option<bool>,
    pub first_person: Option<bool>,
    // Defaulted so omission means "show everything", never "hide silently".
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

/// Map a registry row onto the bridge type. Classification flags come
/// straight off the row rather than being re-derived here, since they were
/// computed once at write time and the filter SQL matches those same columns.
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
        queue: r.queue,
        day_multiplier: r.day_multiplier,
        night_multiplier: r.night_multiplier,
    }
}

/// Clears `AppState.discovery_running` on drop, regardless of how
/// `discover_servers` leaves scope (a plain store at the bottom missed the
/// early-return case on a registry-write failure).
struct DiscoveryGuard<'a>(&'a AppState);

impl Drop for DiscoveryGuard<'_> {
    fn drop(&mut self) {
        self.0.discovery_running.store(false, Ordering::Relaxed);
    }
}

/// Discover servers through Steam and store them in the registry.
#[tauri::command]
pub async fn discover_servers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<(), String> {
    crate::log::log_line(&app, "discovery", "discover_servers: start");
    let discovered_at = std::time::Instant::now();
    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        Arc::clone(guard.as_ref().ok_or("Steam not initialized")?)
    };

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Registry not initialized")?.writer()
    };

    // Consumed as a stream so rows land in the registry — and on screen —
    // from the first flush onward, instead of the table sitting empty until
    // the whole request completes.
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

    // Cleared by DiscoveryGuard's Drop, not a manual store at the bottom.
    state.discovery_running.store(true, Ordering::Relaxed);
    let _discovery_guard = DiscoveryGuard(state.inner());

    let mut found = 0usize;
    let mut abandoned = false;
    while let Some(rows) = rx.recv().await {
        // Stop pulling chunks on shutdown so shutdown_steam's join isn't left waiting.
        if state.shutting_down.load(Ordering::Relaxed) {
            abandoned = true;
            crate::log::log_line(
                &app,
                "discovery",
                "discover_servers: shutdown requested, abandoning stream",
            );
            break;
        }

        // No dedup pass needed: upsert is idempotent on (ip, query_port).
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

    // All registry upserts are done before `pump.await`, so a `get_server_list`
    // issued after this returns sees the full list.
    crate::log::log_line(
        &app,
        "discovery",
        &format!(
            "discover_servers: done, found {found} in {:?}",
            discovered_at.elapsed()
        ),
    );

    // Don't wait on an abandoned stream — that's precisely what would block the exit path.
    if abandoned {
        crate::log::log_line(
            &app,
            "discovery",
            "discover_servers: not waiting on the abandoned pump",
        );
    } else {
        pump.await.map_err(|e| format!("Task join error: {e}"))??;
        crate::log::log_line(&app, "discovery", "discover_servers: complete");
    }

    Ok(())
}

/// Query the SQLite registry for the filtered/sorted server list.
#[tauri::command]
pub async fn get_server_list(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    filter_params: FilterParams,
    sort_params: SortParams,
) -> Result<Vec<Server32>, String> {
    // Startup hangs on whether this query resolves promptly, so every call is timelogged.
    let started = std::time::Instant::now();
    crate::log::log_line_verbose(&app, "servers", "get_server_list: start");
    let result: Result<Vec<Server32>, String> = blocking_read(&state, move |reader| {
        let filter = filter_from_params(filter_params);
        let (sort_key, sort_dir) = sort_from_params(&sort_params);
        let rows = reader
            .list(&filter, sort_key, sort_dir, sort_params.limit)
            .map_err(|e| e.to_string())?;
        Ok(rows.iter().map(to_server32).collect())
    })
    .await;
    match &result {
        // Success is the hot path, so verbose-only; a failure stays at full volume.
        Ok(rows) => crate::log::log_line_verbose(
            &app,
            "servers",
            &format!(
                "get_server_list: {} rows in {:?}",
                rows.len(),
                started.elapsed()
            ),
        ),
        Err(e) => crate::log::log_line(
            &app,
            "servers",
            &format!("get_server_list: error after {:?}: {e}", started.elapsed()),
        ),
    }
    result
}

/// Look up a single server by address, regardless of whatever filter/sort
/// the table currently has loaded. Exists for the `dzsa://` deep-link flow,
/// where the named server may not be in the frontend's currently-loaded rows.
#[tauri::command]
pub async fn get_server(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<Option<Server32>, String> {
    let key = server_key(&addr, query_port)?;
    blocking_read(&state, move |reader| {
        Ok(reader
            .get(key)
            .map_err(|e| e.to_string())?
            .map(|row| to_server32(&row)))
    })
    .await
}

/// One server's A2S_INFO probe outcome, on the way into a registry write.
struct InfoBatchResult {
    refreshed: usize,
    failed: usize,
    /// Servers that answered — candidates for an A2S_RULES mod-list probe.
    rules_candidates: Vec<(ServerKey, SocketAddr)>,
    /// Whether offline marks were suppressed as likely a local network blip
    /// — see `OFFLINE_CORROBORATION_THRESHOLD`.
    offline_marks_suppressed: bool,
}

/// Phase 1 of a refresh: A2S_INFO every address, writing results in batches.
/// `mark_offline` flips `online` on a non-answer for the targeted refresh,
/// but not the bulk refresh (whose window doesn't cover the whole registry).
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
    let mut rules_candidates: Vec<(ServerKey, SocketAddr)> = Vec::new();
    let mut online_keys: Vec<ServerKey> = Vec::new();
    let mut offline_keys: Vec<ServerKey> = Vec::new();

    // Batching cuts channel round-trips and SQLite transactions by ~WRITE_BATCH x.
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

        // Every responder is a rules-probe candidate — the A2S keyword field
        // can't be trusted to flag modded servers.
        rules_candidates.push((key, outcome.addr));

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

    // A miss only counts as corroborated downtime once enough of the batch
    // answered to make the failure share meaningful.
    let total = refreshed + failed;
    let failure_rate = if total > 0 {
        failed as f64 / total as f64
    } else {
        0.0
    };
    let offline_marks_suppressed = mark_offline
        && total >= MIN_BATCH_FOR_OFFLINE_CORROBORATION
        && failure_rate > OFFLINE_CORROBORATION_THRESHOLD;

    if !offline_marks_suppressed && !offline_keys.is_empty() {
        let _ = writer.set_online(offline_keys, false).await;
    }
    let _ = window.emit("server-refreshed", serde_json::json!({ "phase": "info" }));

    InfoBatchResult {
        refreshed,
        failed,
        rules_candidates,
        offline_marks_suppressed,
    }
}

/// Issue one rules probe as a task on `tasks`.
fn spawn_rules_task(
    tasks: &mut tokio::task::JoinSet<(
        ServerKey,
        bool,
        Option<Vec<tetra_core::a2s::dayz::ServerMod>>,
    )>,
    prober: &Prober,
    writer: &tetra_registry::Writer,
    key: ServerKey,
    addr: SocketAddr,
) {
    let prober = prober.clone();
    let writer = writer.clone();
    tasks.spawn(async move {
        match prober.rules_with_deadline(addr, RULES_DEADLINE).await {
            // Writing an empty mod list is deliberate: it records "asked,
            // declared nothing" as mod_count = 0, which the UI shows
            // differently from never-probed (NULL).
            Ok(rules) => {
                let ok = writer
                    .upsert_server_mods(key, rules.mods.clone())
                    .await
                    .is_ok();
                (key, ok, Some(rules.mods))
            }
            Err(_) => (key, false, None),
        }
    });
}

/// Phase 2 of a refresh: A2S_RULES for every server phase 1 answered.
/// Returns writes succeeded, mods per server, and candidates that timed out.
async fn probe_rules(
    prober: &Prober,
    candidates: Vec<(ServerKey, SocketAddr)>,
    writer: &tetra_registry::Writer,
) -> (
    usize,
    Vec<(ServerKey, Vec<tetra_core::a2s::dayz::ServerMod>)>,
    usize,
) {
    let mut mods_updated = 0usize;
    let mut mod_lists = Vec::new();
    let mut cancelled = 0usize;

    let mut pending = candidates.into_iter();
    let mut tasks = tokio::task::JoinSet::new();

    let fanout = rules_fanout(prober);
    for (key, addr) in pending.by_ref().take(fanout) {
        spawn_rules_task(&mut tasks, prober, writer, key, addr);
    }

    while let Some(joined) = tasks.join_next().await {
        if let Ok((key, ok, mods)) = joined {
            if ok {
                mods_updated += 1;
            }
            match mods {
                Some(m) => mod_lists.push((key, m)),
                None => cancelled += 1,
            }
        }
        if let Some((key, addr)) = pending.next() {
            spawn_rules_task(&mut tasks, prober, writer, key, addr);
        }
    }

    (mods_updated, mod_lists, cancelled)
}

/// A2S-refresh servers using the active frontend filter.
///
/// This is the *bulk* refresh, backing the initial post-discovery load and
/// the DISCOVER button. The REFRESH button calls `refresh_visible_servers`
/// instead.
#[tauri::command]
pub async fn refresh_servers(
    app: tauri::AppHandle,
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
    let (mods_updated, _mod_lists, mods_cancelled) =
        probe_rules(&prober, info.rules_candidates, &writer).await;
    if mods_cancelled > 0 {
        crate::log::log_line(
            &app,
            "refresh",
            &format!("refresh_servers: {mods_cancelled} rules probes did not answer in time"),
        );
    }

    let _ = window.emit(
        "refresh-complete",
        serde_json::json!({
            "ok": info.refreshed,
            "failed": info.failed,
            "mods_updated": mods_updated,
            "mods_cancelled": mods_cancelled,
        }),
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

/// A2S-refresh exactly the servers the frontend passes in — the whole
/// currently filtered/loaded list, not just what the virtualizer has
/// mounted. This is what the REFRESH button calls.
///
/// Unlike `refresh_servers`, a non-answer here can mean the server is really
/// offline (every address is one the user has loaded), subject to the same
/// corroboration check as `probe_info`. Also re-asks Steam whether any
/// declared mod has an update pending.
#[tauri::command]
pub async fn refresh_visible_servers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: tauri::Window,
    addrs: Vec<AddrPort>,
    // Echoed back on `refresh-complete` so the frontend knows whose refresh finished.
    scope: Option<String>,
) -> Result<(), String> {
    // Unparseable entries are skipped, not fatal — one bad address shouldn't fail the whole click.
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
    let (mods_updated, mod_lists, mods_cancelled) =
        probe_rules(&prober, info.rules_candidates, &writer).await;

    if info.offline_marks_suppressed {
        crate::log::log_line(
            &app,
            "refresh",
            &format!(
                "refresh_visible_servers: {} of {} probes failed at once — \
                 treated as a local network problem, none written as offline",
                info.failed,
                info.refreshed + info.failed
            ),
        );
    }
    if mods_cancelled > 0 {
        crate::log::log_line(
            &app,
            "refresh",
            &format!(
                "refresh_visible_servers: {mods_cancelled} rules probes did not answer in time"
            ),
        );
    }

    // Phase 3: ask Steam about pending updates for the mods just re-declared. Best-effort.
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
        serde_json::json!({
            "ok": info.refreshed,
            "failed": info.failed,
            "mods_updated": mods_updated,
            "mods_cancelled": mods_cancelled,
            "offline_marks_suppressed": info.offline_marks_suppressed,
            "scope": scope,
        }),
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

/// Set a server's favourite flag, persisted in the registry. Errors if
/// `addr` isn't a known row, rather than silently succeeding on a no-op
/// `UPDATE` — the frontend's optimistic toggle reverts on `Err`.
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
    let affected = writer
        .set_favourite(key, favourite)
        .await
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!("{addr} is not in the registry yet"));
    }
    Ok(())
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

/// Whether the registry fell back to in-memory storage at startup (app
/// works, but forgets everything on exit) — see the fallback in `lib.rs`.
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

/// Build a `ServerKey` from the bridge's `"IP:query_port"` string. Only the
/// IP is read from it — `query_port` is taken as authoritative.
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
        hide_offline: p.hide_offline,
        max_ping_ms: p.max_ping,
        search: p.search,
        favourites_only: p.favourites_only,
        recent_only: p.recent_only,
        official: p.official,
        modded: p.modded,
        first_person: p.first_person,
        // Not a setting — a never-probed row has no name/players/map, so showing it is only noise.
        hide_unnamed: true,
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

    /// Pins the wire convention: `addr` already carries `"IP:query_port"`, so
    /// appending the port again would build an invalid double-port string.
    #[test]
    fn an_address_already_carrying_a_port_is_not_given_a_second_one() {
        let key = server_key("172.111.51.137:27022", 27022).expect("should parse");
        assert_eq!(key.ip.to_string(), "172.111.51.137");
        assert_eq!(key.query_port, 27022);

        let socket = std::net::SocketAddr::from((key.ip, key.query_port));
        assert_eq!(socket.to_string(), "172.111.51.137:27022");
    }

    /// `query_port` is authoritative over the port embedded in the string.
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
