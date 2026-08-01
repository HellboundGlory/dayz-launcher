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
    /// Hide servers Steam lists but that have never answered a probe, so carry
    /// no name at all. Roughly a quarter of a typical registry.
    pub hide_unnamed_servers: bool,
    /// Hide hosting-company defaults and template names ("nitrado.net
    /// gameserver", "EXAMPLE NAME") — see `classify::names::is_placeholder_name`.
    pub hide_placeholder_servers: bool,
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
            // On by default: both hide servers that carry no information a
            // player could choose by. Both are reversible in Settings.
            hide_unnamed_servers: true,
            hide_placeholder_servers: true,
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

#[cfg(test)]
mod tests {
    use super::AppSettings;

    /// A settings file written by an older build must pick up new fields at
    /// their defaults, not at `false`.
    ///
    /// This is what `#[serde(default)]` on the container buys, and it is load
    /// bearing for every upgrade: `hideUnnamedServers` and
    /// `hidePlaceholderServers` arrived in v1.0.1, so every existing install has
    /// a file without them. Falling back to `bool::default()` would silently
    /// turn the new browser filters off for exactly the users the release was
    /// for, and nothing else in the app would report it.
    #[test]
    fn a_settings_file_from_an_older_build_gains_the_new_defaults() {
        let old = r#"{
            "profileName": "James",
            "steamPath": null,
            "dayzPath": "C:\\DayZ",
            "workshopPath": null,
            "maxConcurrentQueries": 1024,
            "queryTimeoutMs": 1000,
            "launchParams": [],
            "closeToTray": true,
            "autoRefreshIntervalSecs": 60,
            "autoJoinAfterDownload": true
        }"#;

        let parsed: AppSettings = serde_json::from_str(old).expect("older file should still load");
        assert_eq!(
            parsed.profile_name, "James",
            "existing values are preserved"
        );
        assert_eq!(parsed.dayz_path.as_deref(), Some("C:\\DayZ"));
        assert!(parsed.hide_unnamed_servers, "new filter defaulted off");
        assert!(parsed.hide_placeholder_servers, "new filter defaulted off");
    }

    /// The round trip the frontend store relies on: every field it sends back
    /// must survive serialise → deserialise unchanged, including `false`.
    #[test]
    fn settings_round_trip_preserves_an_opted_out_user() {
        let opted_out = AppSettings {
            hide_unnamed_servers: false,
            hide_placeholder_servers: false,
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&opted_out).expect("serialise");
        assert!(
            json.contains("hideUnnamedServers"),
            "must serialise in camelCase to match the frontend: {json}"
        );
        let back: AppSettings = serde_json::from_str(&json).expect("deserialise");
        assert!(!back.hide_unnamed_servers, "an explicit false was lost");
        assert!(!back.hide_placeholder_servers, "an explicit false was lost");
    }
}
