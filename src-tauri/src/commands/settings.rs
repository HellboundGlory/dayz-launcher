use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// What the launcher does with itself once DayZ is starting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnJoin {
    #[default]
    Stay,
    /// Hide to the tray, independent of `close_to_tray`.
    Tray,
    Close,
}

/// Retired in favour of `close_to_tray`/`minimise_to_tray`. Read once to
/// migrate, never written — see .ai-notes/src-tauri/src/commands/settings.rs.md.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnClose {
    Tray,
    Minimise,
    Quit,
}

/// Interface scale, as a webview zoom factor. Floor 1.0 (type sizes are
/// hard-coded pixels, already edge-of-readable at 100%); ceiling 1.5 (beyond
/// that [`MIN_WINDOW`] stops fitting on a 1080p screen).
pub const MIN_UI_SCALE: f64 = 1.0;
pub const MAX_UI_SCALE: f64 = 1.5;
pub const DEFAULT_UI_SCALE: f64 = 1.25;

/// User settings, persisted as JSON beside the registry in the app data
/// dir. camelCase to match the frontend store's field names directly.
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
    /// The close button hides the launcher to the tray instead of quitting.
    /// `Option` so "absent" is distinguishable from "chosen" — read via
    /// [`AppSettings::closes_to_tray`], not directly.
    pub close_to_tray: Option<bool>,
    /// The minimise button hides to the tray instead of the taskbar.
    /// Independent of `close_to_tray` on purpose.
    pub minimise_to_tray: bool,
    /// Retired in favour of the two booleans above; read once, never
    /// written (`skip_serializing` drops it on the next save).
    #[serde(skip_serializing)]
    pub on_close: Option<OnClose>,
    /// Interface scale, applied as a webview zoom factor. Defaults to 1.25
    /// (100% was too small to read comfortably). Adjustable from the status bar slider.
    pub ui_scale: f64,
    /// Seconds between automatic refreshes of the visible rows. `0` is off.
    pub auto_refresh_interval_secs: u64,
    /// Register the launcher to start when Windows does. Applied by
    /// `apply_autostart`; the OS registry is the authority, this is the intent.
    pub start_with_windows: bool,
    /// Start hidden, leaving only the tray icon. Only meaningful alongside `start_with_windows`.
    pub start_minimised: bool,
    /// What the launcher does with itself once DayZ is starting.
    pub on_join: OnJoin,
    /// Set once the first-launch setup modal is completed or skipped, so it
    /// never shows again even if the user left the name/path blank.
    pub onboarding_dismissed: bool,
    /// Hide hosting-company defaults and template names — see
    /// `classify::names::is_placeholder_name`.
    pub hide_placeholder_servers: bool,
    /// The ENGLISH ONLY filter tag. Tri-state: keep English, keep
    /// non-English, or don't filter. See `classify::names::is_english_name`.
    pub english_names_filter: Option<bool>,
    /// Show "Playing on {server}" / "Browsing servers" in Discord. `Option`
    /// so `discord_presence_enabled` can tell "never set" from "explicitly off".
    pub discord_rich_presence: Option<bool>,
    /// The window's size, position and maximised state — see [`crate::window_state`].
    pub window: Option<crate::window_state::WindowState>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            profile_name: String::new(),
            steam_path: None,
            dayz_path: None,
            workshop_path: None,
            max_concurrent_queries: tetra_net::MAX_IN_FLIGHT,
            query_timeout_ms: 1000,
            launch_params: Vec::new(),
            // `None`, not `Some(true)`: lets `closes_to_tray`'s migration
            // distinguish "never written" from "user chose true".
            close_to_tray: None,
            minimise_to_tray: false,
            on_close: None,
            ui_scale: DEFAULT_UI_SCALE,
            auto_refresh_interval_secs: 0,
            start_with_windows: false,
            start_minimised: false,
            on_join: OnJoin::Stay,
            onboarding_dismissed: false,
            hide_placeholder_servers: true,
            english_names_filter: Some(true),
            // `None`, not `Some(true)` — same reasoning as `close_to_tray`.
            discord_rich_presence: None,
            window: None,
        }
    }
}

impl AppSettings {
    /// Whether the close button hides to the tray, with the retired dropdown folded in.
    pub fn closes_to_tray(&self) -> bool {
        self.close_to_tray.unwrap_or(match self.on_close {
            Some(OnClose::Minimise) | Some(OnClose::Quit) => false,
            Some(OnClose::Tray) | None => true,
        })
    }

    /// Whether Discord Rich Presence is on.
    pub fn discord_presence_enabled(&self) -> bool {
        self.discord_rich_presence.unwrap_or(true)
    }

    /// The zoom factor to actually apply, clamped back into range — a `0` in
    /// the file would otherwise collapse the window.
    pub fn scale(&self) -> f64 {
        if self.ui_scale.is_finite() {
            self.ui_scale.clamp(MIN_UI_SCALE, MAX_UI_SCALE)
        } else {
            DEFAULT_UI_SCALE
        }
    }

    /// Fold retired fields into their replacements, so everything downstream sees one canonical shape.
    fn migrate(&mut self) {
        self.close_to_tray = Some(self.closes_to_tray());
        self.on_close = None;
        self.ui_scale = self.scale();
        self.discord_rich_presence = Some(self.discord_presence_enabled());
    }
}

/// The settings file's name, in one place because `paths::migrate` also has to know it.
pub const FILENAME: &str = "settings.json";

/// `<data root>/settings.json`, the same directory the registry lives in.
fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::paths::data_root(app);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir.join(FILENAME))
}

/// Read and parse the settings file, falling back to defaults on a missing
/// or corrupt file (non-fatal; the next save overwrites it).
fn read_from_disk(path: &std::path::Path) -> AppSettings {
    let mut settings = match std::fs::read_to_string(path) {
        Err(_) => AppSettings::default(),
        Ok(raw) => serde_json::from_str::<AppSettings>(&raw).unwrap_or_else(|e| {
            eprintln!(
                "[settings] {} is unreadable ({e}); using defaults",
                path.display()
            );
            AppSettings::default()
        }),
    };
    settings.migrate();
    settings
}

/// Make the OS startup entry match `start_with_windows`. Reconciled on every
/// save and once at startup. Debug builds never touch the OS.
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

/// The smallest window the layout is designed to survive, in CSS pixels at
/// 100% scale. Mirrored by minWidth/minHeight in tauri.conf.json.
const MIN_WINDOW: (f64, f64) = (975.0, 620.0);

/// Apply the interface scale to the window: zoom the webview, and raise the
/// minimum window size to match [`MIN_WINDOW`]. No-op when the scale hasn't
/// changed, so a checkbox toggle can't drop a maximised window out of maximised.
pub fn apply_ui_scale(app: &AppHandle, scale: f64) {
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(applied) = state.applied_ui_scale.lock() {
            if (*applied - scale).abs() < f64::EPSILON {
                return;
            }
        }
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(e) = window.set_zoom(scale) {
        eprintln!("[settings] Could not set interface scale to {scale}: {e}");
    }
    if let Err(e) = window.set_min_size(Some(minimum_size(scale))) {
        eprintln!("[settings] Could not raise the minimum window size: {e}");
    }
    eprintln!("[settings] Interface scale {scale}");

    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut applied) = state.applied_ui_scale.lock() {
            *applied = scale;
        }
    }
}

/// The smallest permitted window at a given scale.
fn minimum_size(scale: f64) -> tauri::LogicalSize<f64> {
    tauri::LogicalSize::new(MIN_WINDOW.0 * scale, MIN_WINDOW.1 * scale)
}

/// Grow the window if the geometry restored from a previous run is smaller
/// than the current scale allows. Startup only, not part of `apply_ui_scale`.
pub fn fit_window_to_minimum(app: &AppHandle, scale: f64) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // Nothing to correct on a maximised window, and resizing one un-maximises it.
    if window.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(size), Ok(factor)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };
    let min = minimum_size(scale);
    let current = size.to_logical::<f64>(factor);
    if current.width >= min.width && current.height >= min.height {
        return;
    }
    let grown =
        tauri::LogicalSize::new(current.width.max(min.width), current.height.max(min.height));
    match window.set_size(grown) {
        Ok(()) => eprintln!(
            "[settings] Window was {}x{}, grown to the {}x{} minimum",
            current.width, current.height, grown.width, grown.height
        ),
        Err(e) => eprintln!("[settings] Could not grow the window to the minimum: {e}"),
    }
}

/// Apply the interface scale live, from the status-bar slider. Separate
/// from `save_settings` so dragging is immediate; the frontend persists
/// once the drag ends.
#[tauri::command]
pub fn set_ui_scale(app: AppHandle, scale: f64) {
    let scale = if scale.is_finite() {
        scale.clamp(MIN_UI_SCALE, MAX_UI_SCALE)
    } else {
        DEFAULT_UI_SCALE
    };
    apply_ui_scale(&app, scale);
}

/// Read settings synchronously, for `setup` (which runs before any window
/// exists). Transport settings are consumed exactly once here to size the
/// process-wide prober, and deliberately not re-read on save.
pub fn load_at_startup(app: &AppHandle) -> AppSettings {
    let mut settings = match settings_path(app) {
        Ok(path) => read_from_disk(&path),
        Err(e) => {
            eprintln!("[settings] {e}; using defaults");
            AppSettings::default()
        }
    };

    // One-time upgrade: geometry from the retired window-state plugin's own
    // file, folded in and the file deleted. Guarded on `None` so it never
    // overwrites geometry this build has already saved.
    if settings.window.is_none() {
        settings.window = crate::window_state::adopt_legacy(&crate::paths::data_root(app));
    }
    settings
}

/// Write the window geometry captured during this session, leaving every
/// other setting as the file has it. Read-modify-write, since the frontend
/// may have written since startup.
pub fn persist_window_state(app: &AppHandle) {
    let Some(state) = crate::window_state::cached(app) else {
        return;
    };
    let Ok(path) = settings_path(app) else {
        return;
    };

    let mut settings = read_from_disk(&path);
    if settings.window == Some(state) {
        return;
    }
    settings.window = Some(state);

    let Ok(json) = serde_json::to_string_pretty(&settings) else {
        return;
    };
    if let Err(e) = crate::atomic_write::write_atomically(&path, json.as_bytes()) {
        eprintln!("[settings] Could not save the window geometry: {e}");
    }
}

/// Show the data directory in the system file manager. Windows: Explorer.
/// Linux: the desktop opener.
#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let dir = crate::paths::data_root(&app);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer");
    #[cfg(not(target_os = "windows"))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open {}: {e}", dir.display()))
}

/// The data directory, for display in Settings.
#[tauri::command]
pub fn data_folder_path(app: AppHandle) -> String {
    crate::paths::data_root(&app).to_string_lossy().into_owned()
}

/// `async` so the file read lands on a blocking task instead of the main thread.
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    tokio::task::spawn_blocking(move || read_from_disk(&path))
        .await
        .map_err(|e| format!("Task join error: {e}"))
}

/// Write settings to disk, atomically (temp file + rename).
#[tauri::command]
pub async fn save_settings(app: AppHandle, mut settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;

    // Window geometry is not the frontend's to send — its payload always
    // omits `window`, which would otherwise erase the remembered geometry on every save.
    settings.window = crate::window_state::cached(&app).or(settings.window);

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Could not serialise settings: {e}"))?;

    // Re-published before the write so a toggle takes effect on the very
    // next close even if the disk write is slow.
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        use std::sync::atomic::Ordering;
        state
            .close_to_tray
            .store(settings.closes_to_tray(), Ordering::Relaxed);
        state
            .minimise_to_tray
            .store(settings.minimise_to_tray, Ordering::Relaxed);
        if let Ok(mut guard) = state.on_join.lock() {
            *guard = settings.on_join;
        }
    }
    if settings.discord_presence_enabled() {
        crate::discord::enable(&app);
    } else {
        crate::discord::disable(&app);
    }
    apply_autostart(&app, settings.start_with_windows);
    apply_ui_scale(&app, settings.scale());

    tokio::task::spawn_blocking(move || {
        crate::atomic_write::write_atomically(&path, json.as_bytes())
            .map_err(|e| format!("Could not save {}: {e}", path.display()))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, DEFAULT_UI_SCALE, MAX_UI_SCALE};

    /// Parse the way `read_from_disk` does — migration is part of reading a file.
    fn load(raw: &str) -> AppSettings {
        let mut settings: AppSettings = serde_json::from_str(raw).expect("should parse");
        settings.migrate();
        settings
    }

    #[test]
    fn an_explicit_close_to_tray_opt_out_survives() {
        assert!(!load(r#"{ "closeToTray": false }"#).closes_to_tray());
    }

    #[test]
    fn close_to_tray_defaults_on() {
        assert!(load(r#"{ "closeToTray": true }"#).closes_to_tray());
        // And a file predating every version of this setting.
        assert!(load("{}").closes_to_tray());
    }

    #[test]
    fn the_retired_dropdown_migrates_to_the_boolean() {
        assert!(load(r#"{ "onClose": "tray" }"#).closes_to_tray());
        assert!(!load(r#"{ "onClose": "quit" }"#).closes_to_tray());
        assert!(!load(r#"{ "onClose": "minimise" }"#).closes_to_tray());
    }

    #[test]
    fn close_to_tray_wins_over_the_retired_dropdown() {
        assert!(load(r#"{ "closeToTray": true, "onClose": "quit" }"#).closes_to_tray());
    }

    #[test]
    fn discord_presence_defaults_on() {
        assert!(load(r#"{ "discordRichPresence": true }"#).discord_presence_enabled());
        // And a file predating this setting entirely.
        assert!(load("{}").discord_presence_enabled());
    }

    #[test]
    fn an_explicit_discord_presence_opt_out_survives() {
        assert!(!load(r#"{ "discordRichPresence": false }"#).discord_presence_enabled());
    }

    #[test]
    fn the_retired_dropdown_is_not_written_back() {
        let settings = load(r#"{ "onClose": "quit" }"#);
        let json = serde_json::to_string(&settings).expect("serialise");
        assert!(
            !json.contains("onClose"),
            "the retired field was written back: {json}"
        );
        assert!(json.contains("\"closeToTray\":false"), "{json}");
    }

    #[test]
    fn minimise_and_close_to_tray_do_not_imply_each_other() {
        let settings = load(r#"{ "closeToTray": false, "minimiseToTray": true }"#);
        assert!(!settings.closes_to_tray());
        assert!(settings.minimise_to_tray);
        assert!(!load("{}").minimise_to_tray);
    }

    #[test]
    fn a_file_predating_ui_scale_gets_the_new_default() {
        assert_eq!(load("{}").scale(), DEFAULT_UI_SCALE);
    }

    #[test]
    fn an_out_of_range_scale_is_clamped() {
        assert_eq!(load(r#"{ "uiScale": 0 }"#).scale(), 1.0);
        assert_eq!(load(r#"{ "uiScale": 9 }"#).scale(), MAX_UI_SCALE);
    }

    /// A settings file written by an older build must pick up new fields at
    /// their defaults, not at `bool::default()` — see `#[serde(default)]` on the container.
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
        assert!(parsed.hide_placeholder_servers, "new filter defaulted off");
        // Pinning the Option case: serde fills a missing Option<T> with None
        // absent a default, which would ship this tag silently off for every upgrading install.
        assert_eq!(
            parsed.english_names_filter,
            Some(true),
            "a missing Option field must come from Default, not fall to None"
        );
        assert!(
            parsed.discord_presence_enabled(),
            "an older file predating this setting must not read as opted out"
        );
    }

    /// `None` (show everything) must survive a save/load, not re-default to `Some(true)`.
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
            hide_placeholder_servers: false,
            ..AppSettings::default()
        };
        let json = serde_json::to_string(&opted_out).expect("serialise");
        assert!(
            json.contains("hidePlaceholderServers"),
            "must serialise in camelCase to match the frontend: {json}"
        );
        let back: AppSettings = serde_json::from_str(&json).expect("deserialise");
        assert!(!back.hide_placeholder_servers, "an explicit false was lost");
    }
}
