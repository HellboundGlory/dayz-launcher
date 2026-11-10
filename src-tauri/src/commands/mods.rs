//! The Mods tab's backend: enumerating subscribed Workshop items, verifying
//! and unsubscribing them, persisting a local metadata snapshot, and
//! answering which servers in the browser need which mods. Steam owns what's
//! subscribed/installed; the registry owns servers' declared mod lists.

use crate::state::AppState;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tetra_steam::{StaleOutcome, SubscribedModInfo, WorkshopSearchRow};

/// How old a cached Workshop answer may be before the tab re-asks Steam.
/// Must stay under App.tsx's `MODS_RECHECK_MS` with margin — see notes.
const CACHE_STALE_AFTER_SECS: i64 = 3 * 60;

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

/// Clone the live Steam handle out of the state, or `None` when Steam is not
/// connected.
fn live_steam(state: &AppState) -> Option<Arc<tetra_steam::SteamHandle>> {
    let guard = state.steam.lock().ok()?;
    guard.as_ref().map(Arc::clone)
}

/// Whether Steam's answer proves the snapshot still matches the live set. A
/// check that could not run proves nothing, so the caller re-enumerates.
fn snapshot_current(checked: Option<HashSet<u64>>, cached: HashSet<u64>) -> bool {
    checked.is_some_and(|ids| ids == cached)
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

    // Cheap check that the subscribed set hasn't drifted before trusting the snapshot.
    if !force_details && crate::unix_now() - cached.fetched_at < CACHE_STALE_AFTER_SECS {
        let steam_ids = Arc::clone(&steam);
        let checked = tokio::task::spawn_blocking(move || steam_ids.subscribed_ids())
            .await
            .ok()
            .and_then(Result::ok)
            .map(|ids| ids.into_iter().collect());
        let known: HashSet<u64> = cached
            .rows
            .iter()
            .filter_map(|r| r.workshop_id.parse().ok())
            .collect();
        if snapshot_current(checked, known) {
            return Ok(ModsListOutcome {
                rows: cached.rows,
                from_cache: false,
            });
        }
    }

    let cache_age = if force_details { 0 } else { 3600 };
    let rows = match tokio::task::spawn_blocking(move || steam.subscribed_mods(cache_age)).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(e)) => {
            crate::log::log_line(
                &app,
                "mods",
                &format!("Enumeration failed ({e}); serving the last snapshot"),
            );
            return Ok(ModsListOutcome {
                rows: cached.rows,
                from_cache: true,
            });
        }
        Err(e) => {
            crate::log::log_line(
                &app,
                "mods",
                &format!("Enumeration task failed ({e}); serving the last snapshot"),
            );
            return Ok(ModsListOutcome {
                rows: cached.rows,
                from_cache: true,
            });
        }
    };

    write_cache(
        &path,
        &ModsCache {
            fetched_at: crate::unix_now(),
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
        .filter_map(|id| crate::commands::steam::parse_workshop_id(id).ok())
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

/// One mod declared by at least one registered server — the "Seen on
/// servers" tab of the filter-by-mod modal.
#[derive(serde::Serialize)]
pub struct KnownMod {
    /// Stringified: Workshop ids exceed JS's safe integer range.
    pub workshop_id: String,
    pub name: String,
    pub server_count: usize,
    /// From the Workshop cache at any age; `get_workshop_previews` fills the gaps.
    pub preview_url: Option<String>,
}

/// Every mod seen on a registered server, ranked by how many servers declare
/// it. Unlike `get_mod_usage`, the caller doesn't supply ids up front.
#[tauri::command]
pub async fn get_known_mods(
    state: State<'_, AppState>,
    limit: usize,
) -> Result<Vec<KnownMod>, String> {
    crate::commands::server::blocking_read(&state, move |reader| {
        let rows = reader.known_mods(limit).map_err(|e| e.to_string())?;
        let ids: Vec<u64> = rows.iter().map(|(id, _, _)| *id).collect();
        let mut cache = reader
            .get_workshop_cache(&ids, u64::MAX)
            .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|(id, name, server_count)| KnownMod {
                workshop_id: id.to_string(),
                name,
                server_count,
                preview_url: cache.remove(&id).and_then(|row| row.preview_url),
            })
            .collect())
    })
    .await
}

/// Workshop preview images for mods known only by id, e.g. the "Seen on
/// servers" rows `get_known_mods` had no cached preview for. Ids Steam can't
/// resolve are left out.
#[tauri::command]
pub async fn get_workshop_previews(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let ids: Vec<u64> = workshop_ids
        .iter()
        .filter_map(|id| id.parse().ok())
        .filter(|&id| tetra_steam::ModState::is_workshop_id(id))
        .collect();
    let cache =
        crate::commands::server::resolve_workshop_cache(&state, &ids, Default::default()).await?;
    Ok(cache
        .into_iter()
        .filter_map(|(id, row)| row.preview_url.map(|url| (id.to_string(), url)))
        .collect())
}

/// The "Search Workshop" tab: a live text-search query against the Workshop,
/// scoped to DayZ, independent of what's subscribed or seen on any server.
#[tauri::command]
pub async fn search_workshop_mods(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<WorkshopSearchRow>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let steam = live_steam(&state)
        .ok_or("Steam is not connected. Start Steam and restart the launcher.")?;
    tokio::task::spawn_blocking(move || steam.search_workshop(&query))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|e| format!("Steam query failed: {e}"))
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
    let id = crate::commands::steam::parse_workshop_id(&workshop_id)?;
    tokio::task::spawn_blocking(move || {
        let folder = steam.mod_folder(id).map_err(|e| e.to_string())?;
        if let Some(folder) = folder {
            let folder = workshop_item_dir(&folder, id)?;
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

/// Explicit re-download for mods already known to be outdated — unlike
/// `reinstall_subscribed_mod`, nothing on disk is cleared first.
#[tauri::command]
pub async fn update_subscribed_mods(
    state: State<'_, AppState>,
    workshop_ids: Vec<String>,
) -> Result<(), String> {
    let steam = live_steam(&state)
        .ok_or("Steam is not connected. Start Steam and restart the launcher.")?;
    let ids: Vec<u64> = workshop_ids
        .iter()
        .map(|raw| crate::commands::steam::parse_workshop_id(raw))
        .collect::<Result<_, _>>()?;
    if ids.is_empty() {
        return Ok(());
    }
    tokio::task::spawn_blocking(move || {
        steam
            .force_download(&ids)
            .map_err(|e| format!("Steam query failed: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Reveal a mod's install folder in the system file manager. Steam says where
/// the item is installed (or, offline, DayZ's own library); the folder's shape
/// is verified here, and no path comes from the WebView.
#[tauri::command]
pub async fn open_mod_folder(
    state: State<'_, AppState>,
    workshop_id: String,
) -> Result<(), String> {
    let id = crate::commands::steam::parse_workshop_id(&workshop_id)?;
    let folder = match live_steam(&state) {
        Some(steam) => tokio::task::spawn_blocking(move || steam.mod_folder(id))
            .await
            .map_err(|e| format!("Task join error: {e}"))?
            .map_err(|e| format!("Steam query failed: {e}"))?,
        // Steam is down: fall back to the item's folder in DayZ's own library.
        None => tetra_launch::registry_discovery::find_steam_paths()
            .map(|paths| paths.workshop_dir.join(id.to_string())),
    };
    let folder = folder.ok_or("That mod is not installed")?;

    let target = workshop_item_dir(&folder, id)?;
    tetra_launch::spawn::open_with_desktop(target.as_os_str())
        .map_err(|e| format!("Could not open {}: {e}", target.display()))
}

/// The item's folder, once the path Steam reported is shaped like this item's
/// Workshop content folder. The shape is checked before symlinks are resolved,
/// so a library reached through a symlink still counts.
fn workshop_item_dir(folder: &std::path::Path, id: u64) -> Result<PathBuf, String> {
    let refuse = || "Refusing to open a folder outside a Steam Workshop library".to_string();
    if folder.components().any(|c| {
        matches!(
            c,
            std::path::Component::ParentDir | std::path::Component::CurDir
        )
    }) {
        return Err(refuse());
    }

    let id = id.to_string();
    let app_id = tetra_steam::DAYZ_APP_ID.to_string();
    let expected = [
        "steamapps",
        "workshop",
        "content",
        app_id.as_str(),
        id.as_str(),
    ];
    let actual: Vec<std::ffi::OsString> = folder
        .components()
        .rev()
        .take(expected.len())
        .map(|component| component.as_os_str().to_owned())
        .collect();
    let matches = actual.len() == expected.len()
        && expected
            .iter()
            .rev()
            .zip(&actual)
            .all(|(want, got)| same_name(want, got));
    if !matches {
        return Err(refuse());
    }

    let target = folder
        .canonicalize()
        .map_err(|e| format!("Could not open {}: {e}", folder.display()))?;
    if !target.is_dir() {
        return Err(refuse());
    }
    Ok(target)
}

/// Windows paths are case-insensitive, so the segment names compare that way there.
fn same_name(expected: &str, actual: &std::ffi::OsStr) -> bool {
    #[cfg(target_os = "windows")]
    {
        actual.to_string_lossy().eq_ignore_ascii_case(expected)
    }
    #[cfg(not(target_os = "windows"))]
    {
        actual == std::ffi::OsStr::new(expected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::atomic_write::test_support::ScratchDir;

    #[test]
    fn a_drift_check_that_could_not_run_leaves_the_snapshot_untrusted() {
        let cached: HashSet<u64> = [100, 200].into_iter().collect();

        assert!(!snapshot_current(None, cached.clone()));
        assert!(snapshot_current(Some(cached.clone()), cached.clone()));
        assert!(!snapshot_current(Some([100].into_iter().collect()), cached));
    }

    /// A library whose `steamapps` is a symlink to a differently named folder
    /// is still a Workshop library: the shape is checked on Steam's own path.
    #[cfg(unix)]
    #[test]
    fn a_workshop_item_behind_a_symlinked_library_is_revealed() {
        let root = ScratchDir::new();
        let real = root.join("disk/steam_data/workshop/content/221100/123");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::create_dir_all(root.join("lib")).unwrap();
        std::os::unix::fs::symlink(root.join("disk/steam_data"), root.join("lib/steamapps"))
            .unwrap();

        let reported = root.join("lib/steamapps/workshop/content/221100/123");
        assert_eq!(
            workshop_item_dir(&reported, 123).unwrap(),
            real.canonicalize().unwrap()
        );
        let escaping = root.join("lib/steamapps/workshop/content/221100/../221100/123");
        assert!(workshop_item_dir(&escaping, 123).is_err());
    }

    /// Only a folder shaped like `steamapps/workshop/content/221100/<id>` is
    /// opened, in whichever library Steam installed the item.
    #[test]
    fn only_a_workshop_item_folder_is_revealed() {
        let root = ScratchDir::new();
        let item = root.join("lib/steamapps/workshop/content/221100/123");
        let other_item = root.join("lib2/steamapps/workshop/content/221100/123");
        let plain = root.join("other/123");
        let missing = root.join("missing/123");
        for dir in [&item, &other_item, &plain] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let file_item = root.join("lib/steamapps/workshop/content/221100/77");
        std::fs::write(&file_item, b"").unwrap();

        // Ends in the right shape, so only the dot-dot rule can refuse it.
        let via_parent = root.join("lib/../lib/steamapps/workshop/content/221100/123");

        let cases: &[(&std::path::Path, u64, bool)] = &[
            (&item, 123, true),
            (&item, 456, false),
            (&plain, 123, false),
            (&missing, 123, false),
            (&other_item, 123, true),
            (&file_item, 77, false),
            (&via_parent, 123, false),
        ];
        for (folder, id, ok) in cases {
            let result = workshop_item_dir(folder, *id);
            assert_eq!(result.is_ok(), *ok, "folder: {folder:?}, id: {id}");
            if *ok {
                assert_eq!(result.unwrap(), folder.canonicalize().unwrap());
            }
        }
    }
}
