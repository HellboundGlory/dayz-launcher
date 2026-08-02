use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// What the launcher does with itself once DayZ is starting.
///
/// A dedicated enum rather than a bare string, so the three cases are exhaustive
/// at every call site instead of a `_ => {}` arm swallowing typos.
///
/// Note this does *not* isolate a bad value: an unrecognised variant fails the
/// whole `AppSettings` parse, and `read_from_disk` then falls back to every
/// default rather than just this field. That is how any malformed settings file
/// already behaved, but it is not per-field recovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnJoin {
    /// Leave the window exactly as it is. What the launcher has always done.
    #[default]
    Stay,
    /// Hide to the tray. Independent of `close_to_tray`: the tray exists either
    /// way, and wanting the launcher out of the way during a session is a
    /// different question from what the close button does.
    Tray,
    /// Quit the launcher outright.
    Close,
}

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
    /// Closing the window hides it to the tray instead of quitting.
    ///
    /// Mirrored into `AppState::close_to_tray`, which is what the window-event
    /// handler actually reads — see that field.
    pub close_to_tray: bool,
    /// Seconds between automatic refreshes of the visible rows. `0` is off.
    pub auto_refresh_interval_secs: u64,
    /// Register the launcher to start when Windows does.
    ///
    /// Applied by `apply_autostart` rather than stored anywhere else: the OS
    /// registry is the authority, and this field is the intent. They can drift
    /// if a user removes the entry by hand, so startup reconciles them.
    pub start_with_windows: bool,
    /// Start hidden, leaving only the tray icon. Only meaningful alongside
    /// `start_with_windows` — nobody launches an app by hand to have it not
    /// appear — and the UI disables it when that is off.
    pub start_minimised: bool,
    /// What the launcher does with itself once DayZ is starting.
    pub on_join: OnJoin,
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
    /// The ENGLISH ONLY tag in the filter bar, remembered across restarts.
    ///
    /// Tri-state, matching the tag: `Some(true)` keeps English names,
    /// `Some(false)` keeps only the non-English ones, `None` does not filter on
    /// language. It lives here rather than in the transient filter store
    /// because it defaults to *on* — a default-on filter that reset every
    /// launch would make the player opt out again every session.
    ///
    /// "English" is decided by `classify::names::is_english_name`, which reads
    /// the name only: script, bracketed language tags, accented letters and a
    /// word list.
    pub english_names_filter: Option<bool>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            profile_name: String::new(),
            steam_path: None,
            dayz_path: None,
            workshop_path: None,
            // Mirrors `tetra_net::MAX_IN_FLIGHT`. Was 1024, lowered because the
            // measurement behind that number ran over loopback and so never met
            // a NAT table — see the constant's own docs.
            max_concurrent_queries: tetra_net::MAX_IN_FLIGHT,
            query_timeout_ms: 1000,
            launch_params: Vec::new(),
            close_to_tray: true,
            // Off, not the 60 this field carried while nothing read it. Turning
            // a previously-inert setting into a live one would have switched
            // auto-refresh on for every existing user without their asking, and
            // a refresh re-sorts the table — rows would move under the cursor
            // once a minute mid-click. Opt in from the Server Browser section.
            auto_refresh_interval_secs: 0,
            // Both off: registering for OS startup is not something to opt a
            // user into silently, and starting hidden without it is meaningless.
            start_with_windows: false,
            start_minimised: false,
            on_join: OnJoin::Stay,
            auto_join_after_download: true,
            // On by default: both hide servers that carry no information a
            // player could choose by. Both are reversible in Settings.
            hide_unnamed_servers: true,
            hide_placeholder_servers: true,
            // On by default too. `Some(true)`, not `None` — see the field docs.
            english_names_filter: Some(true),
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

/// Read and parse the settings file, falling back to defaults.
///
/// A missing file is the ordinary first-run case, not an error. A *corrupt*
/// file is also non-fatal: returning defaults keeps the app usable, and the
/// next save overwrites the bad file.
fn read_from_disk(path: &std::path::Path) -> AppSettings {
    let Ok(raw) = std::fs::read_to_string(path) else {
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
}

/// Make the OS startup entry match `start_with_windows`.
///
/// The registry entry is the authority and this is only the intent, so the two
/// can drift — a user removing the entry by hand, or a reinstall to a new path.
/// Reconciling on every save and once at startup keeps the setting honest
/// instead of describing a state that stopped being true.
///
/// Failure is reported and swallowed. Not being able to write an autostart
/// entry is not a reason to refuse to save the rest of someone's settings.
///
/// **Debug builds never touch the OS.** The entry records an absolute path to
/// the executable that wrote it, so a debug build would register
/// `target/debug/tetra-launcher.exe` — a path that moves with every rebuild —
/// and would overwrite the installed release build's entry under the same app
/// name. The toggle still works and still persists in a debug build; only the
/// registry write is suppressed, so the switch has to be tested against a
/// release build.
pub fn apply_autostart(app: &AppHandle, enabled: bool) {
    if cfg!(debug_assertions) {
        eprintln!(
            "[settings] Debug build: start-with-Windows left at {enabled} in settings, \
             OS startup entry not touched."
        );
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    if let Err(e) = result {
        eprintln!(
            "[settings] Could not {} start-with-Windows: {e}",
            if enabled { "enable" } else { "disable" }
        );
    }
}

/// Read settings synchronously, for `setup` — which runs before any window
/// exists and so cannot go through the async command.
///
/// The transport settings are consumed exactly once, here, to size the
/// process-wide prober. They are deliberately not re-read on save: rebuilding
/// the prober under in-flight refreshes would mean tearing down a live
/// semaphore, and since neither has a UI, the only way to change one is editing
/// the JSON by hand — which implies a restart anyway.
pub fn load_at_startup(app: &AppHandle) -> AppSettings {
    match settings_path(app) {
        Ok(path) => read_from_disk(&path),
        Err(e) => {
            eprintln!("[settings] {e}; using defaults");
            AppSettings::default()
        }
    }
}

/// `async` so the file read lands on a blocking task instead of the main
/// thread — a synchronous Tauri command runs inline on the UI thread, and disk
/// I/O there stalls painting. Same reasoning as `save_settings` below.
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    tokio::task::spawn_blocking(move || read_from_disk(&path))
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

    // Re-publish the flag the window-event handler reads. Done before the write
    // rather than after it, so toggling "minimise to tray" takes effect on the
    // very next close even if the disk write is slow — the two copies only
    // disagree if the write fails, and in that case the in-memory one is the
    // behaviour the user just asked for.
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        state
            .close_to_tray
            .store(settings.close_to_tray, std::sync::atomic::Ordering::Relaxed);
        if let Ok(mut guard) = state.on_join.lock() {
            *guard = settings.on_join;
        }
    }
    apply_autostart(&app, settings.start_with_windows);

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
        // The `Option` case is the one worth pinning. Serde fills a missing
        // `Option<T>` with `None` when there is no default in play, and every
        // settings.json in existence was written before this field arrived —
        // if the container `default` did not win here, the ENGLISH ONLY tag
        // would ship silently off for every upgrading install while looking
        // correct on a fresh one.
        assert_eq!(
            parsed.english_names_filter,
            Some(true),
            "a missing Option field must come from Default, not fall to None"
        );
    }

    /// `None` is a state the player can choose (the blank tri-state, "show
    /// everything"), so it has to survive a save/load rather than being
    /// re-defaulted back to `Some(true)` on the next start.
    #[test]
    fn an_explicit_null_language_filter_is_not_re_defaulted() {
        let cleared = AppSettings {
            english_names_filter: None,
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&cleared).expect("serialise");
        assert!(
            json.contains("\"englishNamesFilter\":null"),
            "the cleared state must be written explicitly: {json}"
        );
        let back: AppSettings = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(back.english_names_filter, None, "cleared state was lost");
    }

    /// The inverted tag (✗ — show only names you *cannot* read) round trips too.
    #[test]
    fn an_inverted_language_filter_round_trips() {
        let inverted = AppSettings {
            english_names_filter: Some(false),
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&inverted).expect("serialise");
        let back: AppSettings = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(back.english_names_filter, Some(false));
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
