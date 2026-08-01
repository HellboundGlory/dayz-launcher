use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// User settings, persisted as JSON beside the registry in the app data dir.
///
/// Serialised in camelCase so the on-disk shape and the wire shape match the
/// frontend store's field names exactly — the alternative is a translation
/// layer at the bridge that has to be kept in sync by hand.
///
/// Every field is defaulted individually via `#[serde(default)]` on the struct,
/// so a settings file written by an older build (missing fields added since)
/// still loads instead of being discarded.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub profile_name: String,
    pub steam_path: Option<String>,
    pub dayz_path: Option<String>,
    pub workshop_path: Option<String>,
    pub max_concurrent_queries: usize,
    pub query_timeout_ms: u64,
    pub launch_params: Vec<String>,
    pub close_to_tray: bool,
    pub auto_refresh_interval_secs: u64,
    /// Launch automatically once every required mod finishes downloading.
    ///
    /// When off, "Subscribe and join" still subscribes and downloads, but stops
    /// there and leaves the join to a second click.
    pub auto_join_after_download: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            profile_name: String::new(),
            steam_path: None,
            dayz_path: None,
            workshop_path: None,
            max_concurrent_queries: 1024,
            query_timeout_ms: 1000,
            launch_params: Vec::new(),
            close_to_tray: true,
            auto_refresh_interval_secs: 60,
            auto_join_after_download: true,
        }
    }
}

/// `<app data>/settings.json`, the same directory the registry lives in.
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir.join("settings.json"))
}

/// Read settings from disk, falling back to defaults.
///
/// A missing file is the ordinary first-run case, not an error. A *corrupt*
/// file is also non-fatal: returning defaults keeps the app usable, and the
/// next save overwrites the bad file.
/// `async` so the file read lands on a blocking task instead of the main
/// thread — a synchronous Tauri command runs inline on the UI thread, and disk
/// I/O there stalls painting. Same reasoning as `save_settings` below.
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    tokio::task::spawn_blocking(move || {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            return AppSettings::default();
        };
        match serde_json::from_str(&raw) {
            Ok(settings) => settings,
            Err(e) => {
                eprintln!(
                    "[settings] {} is unreadable ({e}); using defaults",
                    path.display()
                );
                AppSettings::default()
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))
}

/// Write settings to disk.
///
/// Writes to a temporary file and renames over the target, so an interrupted
/// write cannot leave a half-written settings file behind — the rename is
/// atomic and the old file survives until it succeeds.
#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Could not serialise settings: {e}"))?;

    tokio::task::spawn_blocking(move || {
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json)
            .map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &path)
            .map_err(|e| format!("Could not replace {}: {e}", path.display()))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}
