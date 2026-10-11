use crate::state::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

/// Why Steam could not be connected, in the shape the startup modal reads.
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
        // Steam's raw text only — the modal already renders `kind`'s human phrasing as its title.
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

/// Resets `AppState.steam_initialising` on drop, so any exit path from `steam_init` releases it.
struct InitGuard<'a>(&'a AtomicBool);

impl Drop for InitGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Initialize Steamworks client for DayZ (appid 221100). Steam shows
/// "playing DayZ" while the handle lives. Safe to call repeatedly — the
/// startup modal retries this on a timer until Steam is open.
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

    // `steam_ready` alone only guards the window *before* `start()` — this closes
    // the race where two calls arriving close together both run a real init.
    if state
        .steam_initialising
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(tetra_steam::SteamError::Init(
            tetra_steam::InitFailure::AlreadyInitialising,
            "another connection attempt is already in progress".into(),
        )
        .into());
    }
    let _init_guard = InitGuard(&state.steam_initialising);

    let handle = tokio::task::spawn_blocking(tetra_steam::SteamHandle::start)
        .await
        .map_err(|e| SteamInitError::internal(format!("Task join error: {e}")))??;

    // The loser of the race is shut down, not dropped — dropping detaches the thread instead of stopping it.
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

/// Whether the live Steam backend connection is still up (not just whether
/// `steam_init` once succeeded). Cheap atomic read, safe to poll often.
/// Returns `false` rather than erroring when there's no handle yet.
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

/// Download progress for whichever of the given items Steam is transferring; omits items with no active transfer.
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

    let ids: Vec<u64> = workshop_ids
        .iter()
        .filter_map(|id| parse_workshop_id(id).ok())
        .collect();
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

/// Outcome of a batched subscribe/unsubscribe. Ids in `dropped` never reached
/// Steam, so they count as failures like any rejected id.
fn to_outcome(
    results: Vec<tetra_steam::MutationResult>,
    dropped: Vec<(String, String)>,
) -> MutationOutcome {
    let rejected: Vec<(String, String)> = results
        .iter()
        .filter_map(|r| {
            r.error
                .as_ref()
                .map(|e| (r.workshop_id.to_string(), e.clone()))
        })
        .collect();
    let succeeded = results.len() - rejected.len();
    let mut failures = dropped;
    failures.extend(rejected);
    MutationOutcome {
        succeeded,
        failures,
    }
}

/// Parse one Workshop id, with the reason to report when Steam can't use it.
pub(crate) fn parse_workshop_id(raw: &str) -> Result<u64, String> {
    raw.parse::<u64>()
        .ok()
        .filter(|id| tetra_steam::ModState::is_workshop_id(*id))
        .ok_or_else(|| format!("\"{raw}\" is not a Workshop id"))
}

/// Split the given ids into the ones Steam can act on and a reason for each
/// one it can't, so a bad id is answered instead of dropped.
fn parse_ids(workshop_ids: &[String]) -> (Vec<u64>, Vec<(String, String)>) {
    let mut ids = Vec::new();
    let mut dropped = Vec::new();
    for raw in workshop_ids {
        match parse_workshop_id(raw) {
            Ok(id) => ids.push(id),
            Err(reason) => dropped.push((raw.clone(), reason)),
        }
    }
    (ids, dropped)
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

    let (ids, dropped) = parse_ids(&workshop_ids);
    if ids.is_empty() {
        return Ok(MutationOutcome {
            succeeded: 0,
            failures: dropped,
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

    Ok(to_outcome(results, dropped))
}

/// Subscribe to the given workshop items and queue their downloads.
#[tauri::command]
pub async fn steam_subscribe_mods(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<MutationOutcome, String> {
    run_mutation(state, workshop_ids, true).await
}

/// Unsubscribe from the given workshop items — deletes content from disk, may affect other servers sharing the mod. Frontend confirms first.
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

/// Look up the Steam install state of the given workshop items in one batched round trip. Returns an empty list (not an error) when Steam isn't connected yet.
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

#[cfg(test)]
mod tests {
    use super::*;
    use tetra_steam::MutationResult;

    #[test]
    fn ids_that_never_reach_steam_are_reported_individually() {
        let ids: Vec<String> = ["abc", "221100", "0"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let (parsed, dropped) = parse_ids(&ids);

        assert_eq!(parsed, vec![221100]);
        assert_eq!(dropped.len(), 2);
        assert!(dropped[0].0 == "abc" && dropped[0].1.contains("abc"));
        assert!(dropped[1].0 == "0" && dropped[1].1.contains("0"));
    }

    #[test]
    fn dropped_ids_count_as_failures_not_successes() {
        let results = vec![
            MutationResult {
                workshop_id: 221100,
                error: None,
            },
            MutationResult {
                workshop_id: 221200,
                error: Some("Steam said no".into()),
            },
        ];
        let dropped = vec![("abc".to_string(), "not a Workshop id".to_string())];

        let outcome = to_outcome(results, dropped);

        assert_eq!(outcome.succeeded, 1);
        assert_eq!(
            outcome.failures,
            vec![
                ("abc".to_string(), "not a Workshop id".to_string()),
                ("221200".to_string(), "Steam said no".to_string()),
            ]
        );
    }
}
