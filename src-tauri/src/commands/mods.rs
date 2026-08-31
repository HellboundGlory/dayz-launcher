//! The Mods tab's backend: enumerating subscribed Workshop items, verifying
//! and unsubscribing them, persisting a local metadata snapshot, and
//! answering which servers in the browser need which mods. Steam owns what's
//! subscribed/installed; the registry owns servers' declared mod lists.

use crate::state::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tetra_steam::{StaleOutcome, SubscribedModInfo};

/// How old a cached Workshop answer may be before the tab re-asks Steam.
const CACHE_STALE_AFTER_SECS: i64 = 24 * 60 * 60;

/// Name of the snapshot in the data root, beside the registry and settings.
const CACHE_FILENAME: &str = "mods-cache.json";

/// A persisted snapshot of the last successful enumeration.
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModsCache {
    /// Unix seconds when this snapshot was written.
    fetched_at: i64,
    rows: Vec<SubscribedModInfo>,
}

fn cache_path(app: &AppHandle) -> PathBuf {
    crate::paths::data_root(app).join(CACHE_FILENAME)
}

/// Load the snapshot, tolerating a missing or malformed file.
fn read_cache(path: &std::path::Path) -> ModsCache {
    let Ok(text) = std::fs::read_to_string(path) else {
        return ModsCache::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// Persist the snapshot atomically and durably — see `crate::atomic_write`.
fn write_cache(path: &std::path::Path, cache: &ModsCache) {
    let Ok(json) = serde_json::to_string_pretty(cache) else {
        return;
    };
    let _ = crate::atomic_write::write_atomically(path, json.as_bytes());
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Clone the live Steam handle out of the state, or `None` when Steam is not
/// connected.
fn live_steam(state: &AppState) -> Option<Arc<tetra_steam::SteamHandle>> {
    let guard = state.steam.lock().ok()?;
    guard.as_ref().map(Arc::clone)
}

/// Result of loading the Mods tab's list. `from_cache` tells the frontend
/// whether anything was live — an offline open still shows the last snapshot,
/// but the status strip should say so instead of pretending Steam answered.
#[derive(serde::Serialize)]
pub struct ModsListOutcome {
    pub rows: Vec<SubscribedModInfo>,
    pub from_cache: bool,
}

/// Load the subscribed-mod list for the Mods tab. `force_details` bypasses
/// Steam's metadata cache (manual REFRESH). When Steam isn't connected, the
/// last snapshot is served instead of an empty tab.
#[tauri::command]
pub async fn get_subscribed_mods(
    app: AppHandle,
    state: State<'_, AppState>,
    force_details: bool,
) -> Result<ModsListOutcome, String> {
    let path = cache_path(&app);
    let cached = read_cache(&path);

    let Some(steam) = live_steam(&state) else {
        return Ok(ModsListOutcome {
            rows: cached.rows,
            from_cache: true,
        });
    };

    // Serve straight from the snapshot when fresh enough — no Steam round trip.
    if !force_details && now() - cached.fetched_at < CACHE_STALE_AFTER_SECS {
        return Ok(ModsListOutcome {
            rows: cached.rows,
            from_cache: false,
        });
    }

    let cache_age = if force_details { 0 } else { 3600 };
    let rows = match tokio::task::spawn_blocking(move || steam.subscribed_mods(cache_age)).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(e)) => {
            eprintln!("[mods] Enumeration failed ({e}); serving the last snapshot");
            return Ok(ModsListOutcome {
                rows: cached.rows,
                from_cache: true,
            });
        }
        Err(e) => {
            eprintln!("[mods] Enumeration task failed ({e}); serving the last snapshot");
            return Ok(ModsListOutcome {
                rows: cached.rows,
                from_cache: true,
            });
        }
    };

    write_cache(
        &path,
        &ModsCache {
            fetched_at: now(),
            rows: rows.clone(),
        },
    );

    Ok(ModsListOutcome {
        rows,
        from_cache: false,
    })
}

/// VERIFY the given subscribed mods against the Workshop: re-download
/// anything the Workshop has moved past or that isn't on disk, per id.
#[tauri::command]
pub async fn verify_subscribed_mods(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<Vec<StaleOutcome>, String> {
    let steam = live_steam(&state)
        .ok_or("Steam is not connected. Start Steam and restart the launcher.")?;
    let ids: Vec<u64> = workshop_ids
        .iter()
        .filter_map(|id| id.parse().ok())
        .collect();
    let outcomes = tokio::task::spawn_blocking(move || steam.verify_mods(&ids))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| format!("Steam query failed: {e}"))?;
    Ok(outcomes)
}

/// "Needed by" counts for the given mods: every server that declares each one,
/// plus the subset the user cares about (favourites + recently played).
#[derive(serde::Serialize)]
pub struct ModUsage {
    /// Stringified: Workshop ids exceed JS's safe integer range.
    pub workshop_id: String,
    /// Every server in the registry that declares this mod — kept for the
    /// honest blast radius even though the UI only shows favourites.
    pub total_servers: usize,
    /// Favourited servers that declare it — what the details pane's
    /// "Needed by N servers" counts.
    pub favourite_servers: usize,
}

/// "Needed by" counts for the given Workshop ids.
#[tauri::command]
pub async fn get_mod_usage(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<Vec<ModUsage>, String> {
    let ids: Vec<u64> = workshop_ids
        .iter()
        .filter_map(|id| id.parse().ok())
        .collect();
    crate::commands::server::blocking_read(&state, move |reader| {
        let rows = reader.mod_usage(&ids).map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|(id, total, favourites)| ModUsage {
                workshop_id: id.to_string(),
                total_servers: total,
                favourite_servers: favourites,
            })
            .collect())
    })
    .await
}

/// One entry in the Mods tab's server-aware lists.
#[derive(serde::Serialize, Clone)]
pub struct CaredServer {
    pub addr: String,
    pub query_port: u16,
    pub name: String,
}

/// A mod as a server declares it, for the unique-per-server selection and the
/// "needed by" inspector.
#[derive(serde::Serialize)]
pub struct ServerModRef {
    /// Stringified: Workshop ids exceed JS's safe integer range.
    pub workshop_id: String,
    pub name: String,
}

/// Servers the user has signalled interest in, for the "select unique to…"
/// dropdown: favourites plus recently played.
#[tauri::command]
pub async fn get_cared_servers(state: State<'_, AppState>) -> Result<Vec<CaredServer>, String> {
    crate::commands::server::blocking_read(&state, move |reader| {
        let rows = reader.cared_servers().map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|(k, name)| CaredServer {
                addr: k.ip.to_string(),
                query_port: k.query_port,
                name,
            })
            .collect())
    })
    .await
}

/// The mods one server declares that no other *cared* server also declares —
/// the "mods unique to this server" selection.
#[tauri::command]
pub async fn get_unique_mods_for(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<Vec<ServerModRef>, String> {
    let key = crate::commands::server::server_key(&addr, query_port)?;
    crate::commands::server::blocking_read(&state, move |reader| {
        let rows = reader.unique_mods_for(key).map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|(workshop_id, name)| ServerModRef {
                workshop_id: workshop_id.to_string(),
                name,
            })
            .collect())
    })
    .await
}

/// One server that declares a given mod, for the details inspector's
/// "needed by these servers" list.
#[derive(serde::Serialize)]
pub struct ServerNeeding {
    pub addr: String,
    pub query_port: u16,
    pub name: String,
    /// When the user last joined, if ever. Sorted most-recently-played first.
    pub last_played: Option<i64>,
}

/// Which servers in the browser need the given Workshop item.
#[tauri::command]
pub async fn get_servers_needing(
    state: State<'_, AppState>,
    workshop_id: String,
) -> Result<Vec<ServerNeeding>, String> {
    let Some(id) = workshop_id.parse::<u64>().ok() else {
        return Ok(Vec::new());
    };
    crate::commands::server::blocking_read(&state, move |reader| {
        let rows = reader.servers_needing(id).map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|(k, name, last_played)| ServerNeeding {
                addr: k.ip.to_string(),
                query_port: k.query_port,
                name,
                last_played,
            })
            .collect())
    })
    .await
}

/// Force a fresh download of one mod, replacing a corrupt or missing copy:
/// clear the folder Steam reports as installed, then ask it to redownload.
#[tauri::command]
pub async fn reinstall_subscribed_mod(
    state: State<'_, AppState>,
    workshop_id: String,
) -> Result<(), String> {
    let steam = live_steam(&state)
        .ok_or("Steam is not connected. Start Steam and restart the launcher.")?;
    let Some(id) = workshop_id.parse::<u64>().ok() else {
        return Ok(());
    };
    if !tetra_steam::ModState::is_workshop_id(id) {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || {
        let folder = steam.mod_folder(id).map_err(|e| e.to_string())?;
        if let Some(folder) = folder {
            // Best-effort: if delete fails, leave the item alone rather than half-repair it.
            if folder.exists() && std::fs::remove_dir_all(&folder).is_err() {
                return Err(format!(
                    "Could not clear {} — close any tool using it and try again.",
                    folder.display()
                ));
            }
        }
        steam
            .force_download(&[id])
            .map_err(|e| format!("Steam query failed: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Reveal a mod's install folder in the system file manager. Constrained to
/// resolve inside the Steam Workshop content directory — defence in depth
/// against the webview passing an arbitrary path.
#[tauri::command]
pub fn open_mod_folder(folder: String) -> Result<(), String> {
    let workshop_root = tetra_launch::registry_discovery::find_steam_paths()
        .ok_or("Could not locate the Steam Workshop folder")?
        .workshop_dir
        .canonicalize()
        .map_err(|e| format!("Could not resolve the Steam Workshop folder: {e}"))?;

    let path = PathBuf::from(&folder);
    let candidate = if path.exists() {
        &path
    } else {
        path.parent().unwrap_or(&path)
    };
    let target = candidate
        .canonicalize()
        .map_err(|e| format!("Could not open {}: {e}", candidate.display()))?;
    if !target.starts_with(&workshop_root) {
        return Err("Refusing to open a path outside the Steam Workshop folder".into());
    }

    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open {}: {e}", target.display()))
}
