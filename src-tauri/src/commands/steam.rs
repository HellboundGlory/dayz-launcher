use std::sync::Arc;
use tauri::State;
use crate::state::AppState;

#[derive(serde::Serialize)]
pub struct SteamUser {
    pub display_name: String,
    pub steam_id: String,
}

/// Why Steam could not be connected, in the shape the startup modal reads.
///
/// A structured payload rather than a formatted string: the modal needs to pick
/// its wording from `kind`, and needs `auto_retry` to decide whether to keep
/// checking on a timer or wait for the user.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamInitError {
    pub kind: tetra_steam::InitFailure,
    /// Steam's own text, shown as a technical detail line. Not the copy the
    /// user is meant to act on — that comes from `kind`.
    pub message: String,
    /// Whether the launcher should keep retrying by itself.
    pub auto_retry: bool,
    /// How many automatic re-checks to make before giving up and asking the
    /// user to act. `None` means keep going — only ever set for a Steam client
    /// that simply isn't running yet.
    pub auto_retry_limit: Option<u32>,
}

impl SteamInitError {
    fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: tetra_steam::InitFailure::Internal,
            message: message.into(),
            auto_retry: false,
            auto_retry_limit: Some(0),
        }
    }
}

impl From<tetra_steam::SteamError> for SteamInitError {
    fn from(e: tetra_steam::SteamError) -> Self {
        // Steam's raw text only. `SteamError`'s own Display prefixes it with the
        // human phrasing of the kind, which the modal already renders as its
        // title — using it here would print the same sentence twice.
        match e {
            tetra_steam::SteamError::Init(kind, raw) => SteamInitError {
                kind,
                message: raw,
                auto_retry: kind.resolves_by_waiting(),
                auto_retry_limit: kind.auto_retry_limit(),
            },
            other => SteamInitError::internal(other.to_string()),
        }
    }
}

/// Initialize Steamworks client for DayZ (appid 221100).
/// Steam shows "playing DayZ" while the handle lives.
///
/// Safe to call repeatedly: a successful connection short-circuits, and a failed
/// attempt leaves no state behind, so the startup modal can retry this on a
/// timer until the user has Steam open.
///
/// `async` + `spawn_blocking` specifically because of that retry loop.
/// `SteamHandle::start` blocks until the Steam thread answers, which takes a
/// noticeable moment when there is no client to answer — and a synchronous
/// Tauri command runs on the main thread, so polling one would stall the
/// webview (and the modal's own Retry button) on every attempt.
#[tauri::command]
pub async fn steam_init(state: State<'_, AppState>) -> Result<(), SteamInitError> {
    {
        let ready = state
            .steam_ready
            .lock()
            .map_err(|e| SteamInitError::internal(e.to_string()))?;
        if *ready {
            return Ok(());
        }
    }

    let handle = tokio::task::spawn_blocking(tetra_steam::SteamHandle::start)
        .await
        .map_err(|e| SteamInitError::internal(format!("Task join error: {e}")))??;

    // Two attempts overlapping would otherwise leave a second Steam thread
    // running for the life of the process. The loser of the race is shut down
    // rather than dropped — dropping the handle detaches its thread instead of
    // stopping it.
    let mut redundant = None;
    {
        let mut ready = state
            .steam_ready
            .lock()
            .map_err(|e| SteamInitError::internal(e.to_string()))?;
        if *ready {
            redundant = Some(handle);
        } else {
            let mut steam = state
                .steam
                .lock()
                .map_err(|e| SteamInitError::internal(e.to_string()))?;
            *steam = Some(Arc::new(handle));
            *ready = true;
        }
    }
    if let Some(extra) = redundant {
        let _ = extra.shutdown();
    }

    Ok(())
}

#[tauri::command]
pub fn steam_get_user(_state: State<AppState>) -> Result<SteamUser, String> {
    Ok(SteamUser {
        display_name: "Connected".into(),
        steam_id: "0".into(),
    })
}

/// Whether the live Steam backend connection is still up.
///
/// Distinct from `steam_init` succeeding once at startup: that only proves
/// the connection existed at that moment. This reads a flag the actor keeps
/// current via `SteamServersDisconnected`/`SteamServersConnected`, so a
/// connection lost later (the launcher stayed open, Steam's backend session
/// dropped) is visible too — see the `Disconnected` init-failure kind.
///
/// A cheap atomic read, not a round trip through the Steam actor thread, so
/// the frontend can poll this on a short interval without adding load.
/// Returns `false` rather than erroring when there is no handle yet — that
/// is a normal state before `steam_init` succeeds, not a fault.
#[tauri::command]
pub fn steam_connection_state(state: State<AppState>) -> Result<bool, String> {
    let guard = state.steam.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().is_some_and(|h| h.is_connected()))
}

/// Byte progress for one in-flight workshop download.
#[derive(serde::Serialize)]
pub struct DownloadProgress {
    pub workshop_id: String,
    /// Stringified: byte counts can exceed JS's safe integer range.
    pub downloaded: String,
    pub total: String,
}

/// Download progress for whichever of the given items Steam is transferring.
///
/// Items with no active transfer are omitted, so an empty list means nothing is
/// downloading rather than an error.
#[tauri::command]
pub async fn steam_download_progress(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<Vec<DownloadProgress>, String> {
    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(handle) => Arc::clone(handle),
            None => return Ok(Vec::new()),
        }
    };

    let ids = parse_ids(&workshop_ids);
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows = tokio::task::spawn_blocking(move || steam.download_progress(&ids))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| format!("Steam query failed: {e}"))?;

    Ok(rows
        .into_iter()
        .map(|(id, downloaded, total)| DownloadProgress {
            workshop_id: id.to_string(),
            downloaded: downloaded.to_string(),
            total: total.to_string(),
        })
        .collect())
}

/// Outcome of a batched subscribe/unsubscribe.
#[derive(serde::Serialize)]
pub struct MutationOutcome {
    pub succeeded: usize,
    /// `(workshop_id, reason)` for each id that failed.
    pub failures: Vec<(String, String)>,
}

fn to_outcome(results: Vec<tetra_steam::MutationResult>) -> MutationOutcome {
    let failures: Vec<(String, String)> = results
        .iter()
        .filter_map(|r| {
            r.error
                .as_ref()
                .map(|e| (r.workshop_id.to_string(), e.clone()))
        })
        .collect();
    MutationOutcome {
        succeeded: results.len() - failures.len(),
        failures,
    }
}

fn parse_ids(workshop_ids: &[String]) -> Vec<u64> {
    workshop_ids.iter().filter_map(|s| s.parse().ok()).collect()
}

async fn run_mutation(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
    subscribe: bool,
) -> Result<MutationOutcome, String> {
    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        Arc::clone(
            guard
                .as_ref()
                .ok_or("Steam is not connected. Start Steam and restart the launcher.")?,
        )
    };

    let ids = parse_ids(&workshop_ids);
    if ids.is_empty() {
        return Ok(MutationOutcome {
            succeeded: 0,
            failures: Vec::new(),
        });
    }

    // The actor pumps Steam callbacks while it waits for these, so the call
    // blocks for as long as Steam takes to answer — never on an async runtime
    // thread.
    let results = tokio::task::spawn_blocking(move || {
        if subscribe {
            steam.subscribe_all(&ids)
        } else {
            steam.unsubscribe_all(&ids)
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
    .map_err(|e| format!("Steam request failed: {e}"))?;

    Ok(to_outcome(results))
}

/// Subscribe to the given workshop items and queue their downloads.
#[tauri::command]
pub async fn steam_subscribe_mods(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<MutationOutcome, String> {
    run_mutation(state, workshop_ids, true).await
}

/// Unsubscribe from the given workshop items.
///
/// Destructive: Steam deletes the content from disk, and Workshop items are
/// shared between servers, so this can affect servers other than the one the
/// user is looking at. The frontend confirms before calling this.
#[tauri::command]
pub async fn steam_unsubscribe_mods(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<MutationOutcome, String> {
    run_mutation(state, workshop_ids, false).await
}

/// One mod's install state, as the details panel renders it.
#[derive(serde::Serialize)]
pub struct ModStateEntry {
    /// String, not a number: workshop IDs exceed JS's safe integer range.
    pub workshop_id: String,
    pub state: tetra_steam::workshop::ModState,
}

/// Look up the Steam install state of the given workshop items.
///
/// One batched round trip through the Steam actor regardless of how many ids
/// are asked about — a 93-mod server is a single dispatch.
///
/// Returns an empty list rather than an error when Steam is not connected: the
/// panel renders fine without state, and a red error banner for "Steam isn't
/// running yet" during startup would be noise.
#[tauri::command]
pub async fn steam_mod_states(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<Vec<ModStateEntry>, String> {
    let steam = {
        let guard = state.steam.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(handle) => Arc::clone(handle),
            None => return Ok(Vec::new()),
        }
    };

    // Ids that don't parse are dropped rather than failing the batch — one
    // malformed entry shouldn't blank the state of every other mod.
    let ids: Vec<u64> = workshop_ids.iter().filter_map(|s| s.parse().ok()).collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    // `item_state` is a non-blocking local call, but it still has to run on the
    // Steam thread, and `dispatch` blocks waiting for the reply.
    let states = tokio::task::spawn_blocking(move || steam.mod_states(&ids))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| format!("Steam query failed: {e}"))?;

    Ok(states
        .into_iter()
        .map(|(id, state)| ModStateEntry {
            workshop_id: id.to_string(),
            state,
        })
        .collect())
}