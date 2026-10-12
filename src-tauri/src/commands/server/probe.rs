use crate::state::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tetra_net::Prober;
use tetra_registry::rows::ServerKey;

use super::{prober, rules_fanout, server_key};

/// How many servers one refresh probes, independent of the table's display limit.
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

/// Whether a failed probe batch looks like a local network problem rather than
/// the servers being down, in which case none are written as offline.
fn offline_marks_suppressed(mark_offline: bool, refreshed: usize, failed: usize) -> bool {
    let total = refreshed + failed;
    mark_offline
        && total >= MIN_BATCH_FOR_OFFLINE_CORROBORATION
        && (failed as f64 / total as f64) > OFFLINE_CORROBORATION_THRESHOLD
}

/// One server's A2S_INFO probe outcome, on the way into a registry write.
pub(super) struct InfoBatchResult {
    pub(super) refreshed: usize,
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
pub(super) async fn probe_info(
    prober: &Prober,
    addrs: Vec<SocketAddr>,
    writer: &tetra_registry::Writer,
    window: &tauri::Window,
    mark_offline: bool,
) -> InfoBatchResult {
    let log = |msg: String| crate::log::log_line(window.app_handle(), "refresh", &msg);
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
            if let Err(e) = writer.upsert_servers(std::mem::take(&mut batch)).await {
                log(format!("storing probed servers failed: {e}"));
            }
            let _ = window.emit("server-refreshed", serde_json::json!({ "phase": "info" }));
            batch.reserve(WRITE_BATCH);
        }
    }

    if !batch.is_empty() {
        if let Err(e) = writer.upsert_servers(batch).await {
            log(format!("storing probed servers failed: {e}"));
        }
    }
    if !online_keys.is_empty() {
        if let Err(e) = writer.set_online(online_keys, true).await {
            log(format!("marking servers online failed: {e}"));
        }
    }

    // A large batch where most probes failed points at the local network, not
    // the servers, so its misses are not written as offline.
    let offline_marks_suppressed = offline_marks_suppressed(mark_offline, refreshed, failed);

    if !offline_marks_suppressed && !offline_keys.is_empty() {
        if let Err(e) = writer.set_online(offline_keys, false).await {
            log(format!("marking servers offline failed: {e}"));
        }
    }
    let _ = window.emit("server-refreshed", serde_json::json!({ "phase": "info" }));

    InfoBatchResult {
        refreshed,
        failed,
        rules_candidates,
        offline_marks_suppressed,
    }
}

/// A rules probe's server, whether its mod list was stored, and the list (none on timeout).
type RulesResult = (
    ServerKey,
    Result<(), String>,
    Option<Vec<tetra_core::a2s::dayz::ServerMod>>,
);

/// Issue one rules probe as a task on `tasks`.
fn spawn_rules_task(
    tasks: &mut tokio::task::JoinSet<RulesResult>,
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
                let written = writer
                    .upsert_server_mods(key, rules.mods.clone())
                    .await
                    .map_err(|e| e.to_string());
                (key, written, Some(rules.mods))
            }
            Err(_) => (key, Ok(()), None),
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
    let mut write_failures = 0usize;
    let mut write_error = None;

    let mut pending = candidates.into_iter();
    let mut tasks = tokio::task::JoinSet::new();

    let fanout = rules_fanout(prober);
    for (key, addr) in pending.by_ref().take(fanout) {
        spawn_rules_task(&mut tasks, prober, writer, key, addr);
    }

    while let Some(joined) = tasks.join_next().await {
        if let Ok((key, written, mods)) = joined {
            match mods {
                Some(m) => {
                    match written {
                        Ok(()) => mods_updated += 1,
                        Err(e) => {
                            write_failures += 1;
                            write_error = Some(e);
                        }
                    }
                    mod_lists.push((key, m));
                }
                None => cancelled += 1,
            }
        }
        if let Some((key, addr)) = pending.next() {
            spawn_rules_task(&mut tasks, prober, writer, key, addr);
        }
    }

    if let Some(e) = write_error {
        crate::log::line(
            "refresh",
            &format!("storing mod lists failed for {write_failures} servers: {e}"),
        );
    }
    (mods_updated, mod_lists, cancelled)
}

/// One server the frontend wants re-probed, identified the same way the
/// bridge already identifies one for `toggle_favourite`.
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
/// A non-answer here can mean the server is really offline (every address is
/// one the user has loaded), subject to the same corroboration check as
/// `probe_info`. Also re-asks Steam whether any declared mod has an update
/// pending.
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
    //
    // Capped at PROBE_WINDOW: the frontend loads the whole filtered list,
    // which is now the whole browser rather than a 5000-row slice of it, and
    // one click must not turn into tens of thousands of INFO+RULES round
    // trips. The list arrives in the table's sort order, so the cap keeps the
    // first 5,000 rows of that order.
    let socket_addrs: Vec<SocketAddr> = addrs
        .iter()
        .take(PROBE_WINDOW)
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

#[cfg(test)]
mod tests {
    use super::offline_marks_suppressed;

    #[test]
    fn offline_marks_need_eight_probes_and_a_failure_share_above_the_threshold() {
        // Fewer than eight probes: the misses are trusted and marked offline.
        assert!(!offline_marks_suppressed(true, 0, 7));
        // Eight probes, most failed: suppressed.
        assert!(offline_marks_suppressed(true, 3, 5));
        // Exactly 0.4 failed is not above the threshold.
        assert!(!offline_marks_suppressed(true, 6, 4));
        // Just above 0.4 is.
        assert!(offline_marks_suppressed(true, 599, 401));
        // Only failures still suppress once the batch is big enough.
        assert!(offline_marks_suppressed(true, 0, 8));
        // A refresh that may not mark offline never suppresses.
        assert!(!offline_marks_suppressed(false, 0, 100));
    }
}
