use crate::state::AppState;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tetra_steam::to_server_row;

use super::probe::probe_info;
use super::{prober, reader};

/// How many master-list requests one discovery pass keeps in flight.
///
/// Steam paces each request by pinging the servers it lists (~80 rows/s) and
/// paces concurrent requests independently: 32 at once were measured to hold
/// full per-request throughput. A pass is therefore bounded by how many are
/// in flight, not by anything local, so this is sized to run a whole
/// pre-expanded [`tetra_steam::Shard::plan`] at once and cost about what its
/// largest single cell costs.
const SHARD_WORKERS: usize = 32;

/// One instalment from a shard's stream, tagged with the shard it came from so
/// one channel can carry every in-flight request.
enum ShardMsg {
    Rows(Vec<tetra_steam::GameServerRow>),
    Done(Result<(), String>),
}

/// How many never-resolved rows one discovery pass asks itself, after the
/// master pull. Measured at ~105s of A2S_INFO against a real backlog — a
/// tenth of the master pull it follows — and it drains a fresh install's
/// backlog over a few passes.
const RESOLVE_WINDOW: usize = 8000;

/// How long a never-resolved row is left alone after Tetra last asked it, so a
/// short backlog doesn't mean re-probing the same dead addresses every pass.
const RESOLVE_RETRY_AFTER_SECS: i64 = 60 * 60;

/// Clears `AppState.discovery_running` on drop, regardless of how
/// `discover_servers` leaves scope (a plain store at the bottom missed the
/// early-return case on a registry-write failure).
struct DiscoveryGuard<'a>(&'a AppState);

impl Drop for DiscoveryGuard<'_> {
    fn drop(&mut self) {
        self.0.discovery_running.store(false, Ordering::Relaxed);
    }
}

/// Discover servers and store them in the registry.
///
/// The backend index is tried first — one HTTP round trip instead of a
/// ~17-minute master pass — and anything going wrong there falls through to
/// the Steam pass below, unchanged.
///
/// One pass runs every cell of [`tetra_steam::Shard::plan`] concurrently,
/// subdividing any cell Steam truncated at [`tetra_steam::LIST_CAP`], then
/// asks the servers Steam listed but couldn't resolve itself.
#[tauri::command]
pub async fn discover_servers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<(), String> {
    crate::log::log_line(&app, "discovery", "discover_servers: start");
    let discovered_at = std::time::Instant::now();

    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Registry not initialized")?.writer()
    };

    // One master pull at a time: a second `discover_servers` (periodic
    // rediscovery, retry) while one is streaming would queue a duplicate pull
    // behind it in the Steam actor. Swap-once makes the second call a cheap
    // no-op; DiscoveryGuard's Drop clears the flag on every exit path.
    if state.discovery_running.swap(true, Ordering::Relaxed) {
        crate::log::log_line(
            &app,
            "discovery",
            "discover_servers: already running, skipping",
        );
        return Ok(());
    }
    let _discovery_guard = DiscoveryGuard(state.inner());

    // The index already A2S-probed every address it lists, so a pass served
    // from it needs neither the master pull nor `resolve_unlisted`.
    if let Some(found) = crate::commands::index::try_index(&app, &state, &writer, &window).await {
        crate::log::log_line(
            &app,
            "discovery",
            &format!(
                "discover_servers: served {found} servers from the index in {:?}",
                discovered_at.elapsed()
            ),
        );
        return Ok(());
    }

    // Only the Steam path needs the client, and it is acquired here rather
    // than at the top so a launcher whose Steam init failed can still fill
    // its browser from the index.
    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        Arc::clone(guard.as_ref().ok_or("Steam not initialized")?)
    };

    // Steam's list allowance is spent for the life of this process, so every
    // shard would be refused and the pass would report itself as a total
    // failure. Say what is actually wrong instead of running it.
    if steam.lists_remaining() == 0 {
        crate::log::log_line(
            &app,
            "discovery",
            "discover_servers: Steam's per-process list allowance is spent; \
             restart the launcher to refresh the browser",
        );
        let _ = window.emit(
            "discovery-exhausted",
            serde_json::json!({ "reason": "steam-list-allowance" }),
        );
        return Ok(());
    }

    let mut queue: std::collections::VecDeque<tetra_steam::Shard> =
        tetra_steam::Shard::plan().into();
    // Unique across shards: the halves are disjoint but a subdivided shard's
    // children re-list rows the truncated parent already returned, so a raw
    // row count would badly overstate what was found. Upsert stays idempotent
    // on (ip, query_port) either way — this set is only for the count.
    let mut seen: std::collections::HashSet<(Ipv4Addr, u16)> = std::collections::HashSet::new();
    let mut abandoned = false;
    let mut shards_run = 0usize;
    let mut shards_failed = 0usize;
    let mut truncated_shards = 0usize;
    let mut budget_spent = false;

    // Every in-flight shard streams into one channel, so this loop stays the
    // only writer: no shared counters, no locks around `seen`.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<(usize, ShardMsg)>(64);
    // Shard, rows seen so far, and whether it has already been subdivided.
    let mut in_flight: std::collections::HashMap<usize, (tetra_steam::Shard, usize, bool)> =
        std::collections::HashMap::new();
    let mut next_id = 0usize;

    loop {
        if state.shutting_down.load(Ordering::Relaxed) {
            abandoned = true;
            crate::log::log_line(
                &app,
                "discovery",
                "discover_servers: shutdown requested, abandoning in-flight shards",
            );
            break;
        }

        // Top up to the concurrency limit. A shard that finishes early frees
        // its slot for the next one — including children queued by a
        // truncated shard that is still streaming.
        while in_flight.len() < SHARD_WORKERS {
            // The allowance is per process, not per pass: a second rediscovery
            // in the same launch inherits whatever the first one left.
            if steam.lists_remaining() == 0 {
                if !queue.is_empty() && !budget_spent {
                    budget_spent = true;
                    crate::log::log_line(
                        &app,
                        "discovery",
                        &format!(
                            "discover_servers: Steam's per-process list allowance is spent \
                             with {} cells unlisted; no further pass can list them until \
                             the launcher restarts",
                            queue.len()
                        ),
                    );
                }
                break;
            }
            let Some(shard) = queue.pop_front() else {
                break;
            };
            let id = next_id;
            next_id += 1;
            let shard_steam = Arc::clone(&steam);
            let filters = shard.filters.clone();
            let chunk_tx = tx.clone();
            // Consumed as a stream so rows land in the registry — and on
            // screen — from the first flush onward, instead of the table
            // sitting empty until the whole request completes.
            tokio::task::spawn_blocking(move || {
                let chunks = match shard_steam.internet_list_stream(&filters) {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = chunk_tx.blocking_send((
                            id,
                            ShardMsg::Done(Err(format!("Steam discovery failed: {e}"))),
                        ));
                        return;
                    }
                };
                for chunk in chunks {
                    match chunk {
                        tetra_steam::StreamChunk::Rows(rows) => {
                            if chunk_tx.blocking_send((id, ShardMsg::Rows(rows))).is_err() {
                                return;
                            }
                        }
                        tetra_steam::StreamChunk::Done(result) => {
                            let _ = chunk_tx.blocking_send((
                                id,
                                ShardMsg::Done(
                                    result.map_err(|e| format!("Steam discovery failed: {e}")),
                                ),
                            ));
                            return;
                        }
                    }
                }
            });
            in_flight.insert(id, (shard, 0, false));
        }

        if in_flight.is_empty() {
            break;
        }

        let Some((id, msg)) = rx.recv().await else {
            break;
        };

        match msg {
            ShardMsg::Rows(rows) => {
                // Crossing the cap is what says a cell is truncated, and it is
                // knowable now rather than when the request finishes. Waiting
                // for that costs the rest of this request before a child can
                // even be queued, and it is the tail of those serial levels
                // that sets the length of a pass.
                if let Some((shard, count, split)) = in_flight.get_mut(&id) {
                    *count += rows.len();
                    if !*split && *count >= tetra_steam::LIST_CAP {
                        *split = true;
                        truncated_shards += 1;
                        let (label, children) = (shard.label.clone(), shard.subdivide());
                        match children {
                            Some(children) => queue.extend(children),
                            None => crate::log::log_line(
                                &app,
                                "discovery",
                                &format!(
                                    "discover_servers: shard {label} is truncated with no axis \
                                     left; its rows are a partial sample"
                                ),
                            ),
                        }
                    }
                }
                for row in &rows {
                    seen.insert((row.ip, row.query_port));
                }

                let server_rows: Vec<tetra_registry::rows::ServerRow> =
                    rows.iter().map(to_server_row).collect();
                writer
                    .upsert_servers(server_rows)
                    .await
                    .map_err(|e| format!("Registry write error: {e}"))?;

                let _ = window.emit(
                    "discovery-progress",
                    serde_json::json!({ "tier": shards_run + 1, "found": seen.len() }),
                );
            }
            ShardMsg::Done(result) => {
                let Some((shard, shard_rows, split)) = in_flight.remove(&id) else {
                    continue;
                };
                shards_run += 1;

                // One shard failing is not the pass failing: the halves are
                // independent, and the rows other shards already wrote are good.
                if let Err(e) = result {
                    shards_failed += 1;
                    crate::log::log_line(
                        &app,
                        "discovery",
                        &format!("discover_servers: shard {} failed: {e}", shard.label),
                    );
                }

                // Normally the split already happened mid-stream; this catches
                // a request that only reached the cap on its final flush.
                if shard_rows >= tetra_steam::LIST_CAP && !split {
                    truncated_shards += 1;
                    if let Some(children) = shard.subdivide() {
                        queue.extend(children);
                    }
                }

                crate::log::log_line(
                    &app,
                    "discovery",
                    &format!(
                        "discover_servers: shard {} returned {shard_rows} rows \
                         ({} unique so far, {} in flight, {} queued)",
                        shard.label,
                        seen.len(),
                        in_flight.len(),
                        queue.len()
                    ),
                );
            }
        }
    }

    // All registry upserts are done before this returns, so a `get_server_page`
    // issued after it sees the full list.
    crate::log::log_line(
        &app,
        "discovery",
        &format!(
            "discover_servers: done, found {} unique across {shards_run} shards \
             ({shards_failed} failed, {truncated_shards} truncated) in {:?}",
            seen.len(),
            discovered_at.elapsed()
        ),
    );

    // The budget note is logged when the quota runs out, but the queue keeps
    // growing after it, so this is the number that actually went unlisted.
    if !queue.is_empty() {
        crate::log::log_line(
            &app,
            "discovery",
            &format!(
                "discover_servers: {} cells never listed; this pass is a partial \
                 sample of the browser",
                queue.len()
            ),
        );
    }

    if shards_run > 0 && shards_failed == shards_run {
        return Err("Steam discovery failed: every request was refused".into());
    }

    if !abandoned {
        crate::commands::index::record_steam_source(
            state.inner(),
            &window,
            seen.len(),
            discovered_at.elapsed().as_millis(),
        );

        // Backlog probe mostly waits on A2S timeouts, not registry work, so it
        // runs detached rather than holding the command's return on it.
        let app = app.clone();
        let writer = writer.clone();
        let window = window.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            resolve_unlisted(&app, &state, &writer, &window).await;
            crate::log::log_line(&app, "discovery", "discover_servers: complete");
        });
    }

    Ok(())
}

/// Ask the servers Steam listed but could not resolve itself.
///
/// A row Steam failed to ping arrives with `responded = false` and no name,
/// and the upsert refuses to write live fields from it — so the row is stored
/// nameless, and a nameless row is hidden from the browser. Nothing else would
/// ever query it: the REFRESH button only re-probes rows the frontend has
/// loaded, which by definition excludes hidden ones. Tetra's own prober has a
/// different timeout and socket than Steam's, so it reaches plenty of them.
async fn resolve_unlisted(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    writer: &tetra_registry::Writer,
    window: &tauri::Window,
) {
    let backlog = reader(state).and_then(|r| {
        r.unresolved(RESOLVE_WINDOW, RESOLVE_RETRY_AFTER_SECS)
            .map_err(|e| e.to_string())
    });
    let keys = match backlog {
        Ok(keys) => keys,
        Err(e) => {
            crate::log::log_line(app, "discovery", &format!("resolve_unlisted: {e}"));
            return;
        }
    };
    if keys.is_empty() {
        return;
    }

    // Stamped before probing, so a batch of dead addresses rotates out of the
    // window even if every probe times out.
    if let Err(e) = writer.mark_probe_attempt(keys.clone()).await {
        crate::log::log_line(app, "discovery", &format!("resolve_unlisted: {e}"));
        return;
    }

    let prober = match prober(state) {
        Ok(p) => p,
        Err(e) => {
            crate::log::log_line(app, "discovery", &format!("resolve_unlisted: {e}"));
            return;
        }
    };
    let addrs: Vec<SocketAddr> = keys
        .iter()
        .map(|k| SocketAddr::from((k.ip, k.query_port)))
        .collect();
    let asked = addrs.len();

    // A2S_INFO only: this exists to give a hidden row a name, and mods cost a
    // second round trip per server. `mark_offline` stays false — these rows
    // have never been shown to be up in the first place.
    let info = probe_info(&prober, addrs, writer, window, false).await;
    crate::log::log_line(
        app,
        "discovery",
        &format!(
            "resolve_unlisted: asked {asked} never-resolved rows, {} answered",
            info.refreshed
        ),
    );
}
