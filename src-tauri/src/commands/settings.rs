use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Serialises every read and read-modify-write of the settings file.
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

/// Take the settings lock, recovering a poisoned guard.
fn lock_settings() -> std::sync::MutexGuard<'static, ()> {
    SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

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
/// migrate, never written — see .ai-notes/native-shell.md.
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
    /// Seconds between automatic refreshes of the first 5,000 servers in the list. `0` is off.
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
    /// Show "Playing on {server}" / "Browsing servers" in Discord. `Option`
    /// so `discord_presence_enabled` can tell "never set" from "explicitly off".
    pub discord_rich_presence: Option<bool>,
    /// The window's size, position and maximised state — see [`crate::window_state`].
    pub window: Option<crate::window_state::WindowState>,
    /// Which theme is active. `Option` so "never chosen" (the built-in
    /// default) is distinguishable from an empty id; built-in vs. file-backed
    /// is the frontend's distinction, not this backend's.
    pub active_theme_id: Option<String>,
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
            // 60 s: the index supplies the list, but ping is per-user, so a
            // screenful of servers gets its numbers shortly after every load
            // without the user having to hit REFRESH.
            auto_refresh_interval_secs: 60,
            start_with_windows: false,
            start_minimised: false,
            on_join: OnJoin::Stay,
            onboarding_dismissed: false,
            // `None`, not `Some(true)` — same reasoning as `close_to_tray`.
            discord_rich_presence: None,
            window: None,
            active_theme_id: None,
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

/// Read the settings file, moving a corrupt one aside and falling back to defaults.
fn read_from_disk(path: &Path) -> Result<AppSettings, String> {
    let mut settings = match std::fs::read_to_string(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => AppSettings::default(),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            move_corrupt_aside(path, &e.to_string())?
        }
        Err(e) => return Err(format!("Could not read {}: {e}", path.display())),
        Ok(raw) => match serde_json::from_str::<AppSettings>(&raw) {
            Ok(settings) => settings,
            Err(e) => move_corrupt_aside(path, &e.to_string())?,
        },
    };
    settings.migrate();
    Ok(settings)
}

/// Set when a damaged settings file was moved aside, until the frontend has told the player.
static SETTINGS_RECOVERED: AtomicBool = AtomicBool::new(false);

/// Whether settings were reset because the file was damaged; true once, then false.
#[tauri::command]
pub fn take_settings_recovered() -> bool {
    SETTINGS_RECOVERED.swap(false, Ordering::AcqRel)
}

/// Rename a corrupt settings file so the next save cannot overwrite its bytes.
/// If it cannot be moved, the caller must not write over it either.
fn move_corrupt_aside(path: &Path, reason: &str) -> Result<AppSettings, String> {
    let corrupt = path.with_file_name("settings.corrupt.json");
    std::fs::rename(path, &corrupt).map_err(|err| {
        format!(
            "{} is unreadable ({reason}) and could not be moved to {} ({err})",
            path.display(),
            corrupt.display()
        )
    })?;
    crate::log::line(
        "settings",
        &format!(
            "{} is unreadable ({reason}); moved to {}; using defaults",
            path.display(),
            corrupt.display()
        ),
    );
    SETTINGS_RECOVERED.store(true, Ordering::Release);
    Ok(AppSettings::default())
}

/// Read the on-disk settings under the lock, for a caller that only reads.
fn read_locked(path: &Path) -> Result<AppSettings, String> {
    let _guard = lock_settings();
    read_from_disk(path)
}

/// Lock, read, apply `change`, and save only when it reports a change.
fn update_on_disk(
    path: &Path,
    change: impl FnOnce(&mut AppSettings) -> bool,
) -> Result<(), String> {
    let _guard = lock_settings();
    let mut settings = read_from_disk(path)?;
    if !change(&mut settings) {
        return Ok(());
    }
    write_settings(path, &settings)
}

/// Replace the settings file atomically (temp file + rename).
fn write_settings(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Could not serialise settings: {e}"))?;
    crate::atomic_write::write_atomically(path, json.as_bytes())
        .map_err(|e| format!("Could not save {}: {e}", path.display()))
}

/// The settings as the file spells them: one JSON object keyed by field name.
fn settings_fields(settings: &AppSettings) -> Result<Map<String, Value>, String> {
    let Value::Object(fields) =
        serde_json::to_value(settings).map_err(|e| format!("Could not serialise settings: {e}"))?
    else {
        return Err("Settings did not serialise as an object".into());
    };
    Ok(fields)
}

/// Written only by the window and theme code, never by the WebView.
const RUST_OWNED_KEYS: [&str; 2] = ["window", "activeThemeId"];

/// Merge the patch's top-level keys into the on-disk settings and save when a
/// value changed. Returns the settings now on disk and the keys whose values changed.
fn patch_on_disk(path: &Path, patch: &Value) -> Result<(AppSettings, Vec<String>), String> {
    let Value::Object(patch) = patch else {
        return Err("A settings patch must be a JSON object".into());
    };
    let _guard = lock_settings();
    let before = read_from_disk(path)?;
    let before_fields = settings_fields(&before)?;
    let mut merged = before_fields.clone();
    for (key, value) in patch {
        if RUST_OWNED_KEYS.contains(&key.as_str()) {
            return Err(format!("{key} cannot be set from a patch"));
        }
        let slot = merged
            .get_mut(key)
            .ok_or_else(|| format!("Unknown setting: {key}"))?;
        *slot = value.clone();
    }
    let mut after: AppSettings = serde_json::from_value(Value::Object(merged))
        .map_err(|e| format!("Invalid setting value: {e}"))?;
    after.migrate();
    let after_fields = settings_fields(&after)?;
    let changed: Vec<String> = after_fields
        .iter()
        .filter(|(key, value)| before_fields.get(*key) != Some(*value))
        .map(|(key, _)| key.clone())
        .collect();
    if !changed.is_empty() {
        write_settings(path, &after)?;
    }
    Ok((after, changed))
}

/// The current on-disk settings, for a caller that needs one field without
/// going through the frontend. A read error is returned, not defaulted, so a
/// caller never acts on a selection it could not read.
pub fn current(app: &AppHandle) -> Result<AppSettings, String> {
    settings_path(app).and_then(|path| read_locked(&path))
}

/// Read-modify-write `active_theme_id`, like [`persist_window_state`]. Not
/// validated against installed themes — a theme deleted out from under a
/// running app must not make the selection unwritable.
pub fn set_active_theme_id(app: &AppHandle, id: Option<String>) -> Result<(), String> {
    let path = settings_path(app)?;
    update_on_disk(&path, |settings| {
        if settings.active_theme_id == id {
            return false;
        }
        settings.active_theme_id = id;
        true
    })
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
        crate::log::log_line(
            app,
            "settings",
            &format!(
                "Could not {} start-with-Windows: {e}",
                if enabled { "enable" } else { "disable" }
            ),
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
        crate::log::log_line(
            app,
            "settings",
            &format!("Could not set interface scale to {scale}: {e}"),
        );
    }
    if let Err(e) = window.set_min_size(Some(minimum_size(scale))) {
        crate::log::log_line(
            app,
            "settings",
            &format!("Could not raise the minimum window size: {e}"),
        );
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
        Err(e) => crate::log::log_line(
            app,
            "settings",
            &format!("Could not grow the window to the minimum: {e}"),
        ),
    }
}

/// Apply the interface scale live, from the status-bar slider. Separate
/// from `patch_settings` so dragging is immediate; the frontend saves it
/// debounced on each change.
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
    let mut settings = current(app).unwrap_or_else(|e| {
        crate::log::log_line(app, "settings", &format!("{e}; using defaults"));
        AppSettings::default()
    });

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

    if let Err(e) = update_on_disk(&path, |settings| {
        if settings.window == Some(state) {
            return false;
        }
        settings.window = Some(state);
        true
    }) {
        crate::log::log_line(
            app,
            "settings",
            &format!("Could not save the window geometry: {e}"),
        );
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
    tokio::task::spawn_blocking(move || read_locked(&path))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

/// Write the sent top-level keys into the settings file and leave every other
/// key as the file has it. Only the keys whose values changed run their side effects.
#[tauri::command]
pub async fn patch_settings(app: AppHandle, patch: Value) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    let (settings, changed) = tokio::task::spawn_blocking(move || patch_on_disk(&path, &patch))
        .await
        .map_err(|e| format!("Task join error: {e}"))??;
    apply_side_effects(&app, &settings, &changed);
    Ok(settings)
}

/// What each changed key drives. A key with no effect of its own is not listed.
fn apply_side_effects(app: &AppHandle, settings: &AppSettings, changed: &[String]) {
    let has = |key: &str| changed.iter().any(|k| k == key);
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if has("closeToTray") {
            state
                .close_to_tray
                .store(settings.closes_to_tray(), Ordering::Relaxed);
        }
        if has("minimiseToTray") {
            state
                .minimise_to_tray
                .store(settings.minimise_to_tray, Ordering::Relaxed);
        }
        if has("onJoin") {
            if let Ok(mut guard) = state.on_join.lock() {
                *guard = settings.on_join;
            }
        }
    }
    if has("discordRichPresence") {
        if settings.discord_presence_enabled() {
            crate::discord::enable(app);
        } else {
            crate::discord::disable(app);
        }
    }
    if has("startWithWindows") {
        apply_autostart(app, settings.start_with_windows);
    }
    if has("uiScale") {
        apply_ui_scale(app, settings.scale());
    }
}

#[cfg(test)]
mod tests {
    use super::{
        patch_on_disk, read_from_disk, take_settings_recovered, update_on_disk, AppSettings,
        DEFAULT_UI_SCALE, MAX_UI_SCALE,
    };
    use crate::atomic_write::test_support::ScratchDir;
    use serde_json::json;
    use std::fs;

    #[test]
    fn a_patch_changes_only_the_keys_it_names() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        fs::write(
            &path,
            r#"{ "profileName": "James", "activeThemeId": "local.ember", "window": { "width": 1280, "height": 800, "x": 10, "y": 20, "maximized": false } }"#,
        )
        .unwrap();

        patch_on_disk(&path, &json!({ "profileName": "Night Owl" })).unwrap();

        let read = read_from_disk(&path).unwrap();
        assert_eq!(read.profile_name, "Night Owl");
        assert_eq!(read.active_theme_id.as_deref(), Some("local.ember"));
        assert_eq!(read.window.map(|w| w.width), Some(1280));
    }

    #[test]
    fn a_patch_naming_an_unknown_key_is_refused_and_writes_nothing() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        fs::write(&path, r#"{ "profileName": "James" }"#).unwrap();
        let before = fs::read(&path).unwrap();

        let result = patch_on_disk(&path, &json!({ "profileNmae": "Night Owl" }));

        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn a_patch_cannot_set_the_window_or_the_active_theme() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        fs::write(&path, r#"{ "profileName": "James" }"#).unwrap();
        let before = fs::read(&path).unwrap();

        for patch in [
            json!({ "activeThemeId": "../outside" }),
            json!({ "window": null }),
        ] {
            assert!(patch_on_disk(&path, &patch).is_err(), "accepted {patch}");
        }
        assert_eq!(fs::read(&path).unwrap(), before);
    }

    /// Parse the way `read_from_disk` does — migration is part of reading a file.
    fn load(raw: &str) -> AppSettings {
        let mut settings: AppSettings = serde_json::from_str(raw).expect("should parse");
        settings.migrate();
        settings
    }

    #[test]
    fn a_wrong_typed_field_moves_the_file_aside_and_reads_defaults() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        let raw = br#"{ "uiScale": "big" }"#;
        fs::write(&path, raw).unwrap();

        let settings = read_from_disk(&path).unwrap();

        assert_eq!(settings.scale(), DEFAULT_UI_SCALE);
        assert_eq!(fs::read(dir.join("settings.corrupt.json")).unwrap(), raw);
        assert!(!path.exists());
        assert!(take_settings_recovered(), "the player is told once");
    }

    #[test]
    fn a_missing_file_reads_defaults_and_creates_no_corrupt_copy() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");

        let settings = read_from_disk(&path).unwrap();

        assert_eq!(settings.profile_name, "");
        assert!(!dir.join("settings.corrupt.json").exists());
    }

    #[test]
    fn a_file_that_is_not_utf8_is_moved_aside_like_a_parse_error() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        let raw = [0xff, 0xfe, 0x00, 0x01];
        fs::write(&path, raw).unwrap();

        let settings = read_from_disk(&path).unwrap();

        assert_eq!(settings.profile_name, "");
        assert_eq!(fs::read(dir.join("settings.corrupt.json")).unwrap(), raw);
        assert!(!path.exists());
    }

    #[test]
    fn update_on_disk_keeps_fields_it_did_not_touch() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        fs::write(&path, r#"{ "profileName": "James" }"#).unwrap();

        update_on_disk(&path, |settings| {
            settings.active_theme_id = Some("local.ember".into());
            true
        })
        .unwrap();

        let read = read_from_disk(&path).unwrap();
        assert_eq!(read.profile_name, "James");
        assert_eq!(read.active_theme_id.as_deref(), Some("local.ember"));
    }

    #[test]
    fn update_on_disk_writes_nothing_when_the_change_is_a_no_op() {
        let dir = ScratchDir::new();
        let path = dir.join("settings.json");
        fs::write(&path, r#"{ "profileName": "James" }"#).unwrap();
        let before = fs::read(&path).unwrap();

        update_on_disk(&path, |_| false).unwrap();

        assert_eq!(fs::read(&path).unwrap(), before);
    }

    #[test]
    fn a_file_that_cannot_be_read_is_never_written_over() {
        let dir = ScratchDir::new();
        // A directory where the file should be stands in for a file another
        // process holds open: the read fails with something other than "missing".
        let path = dir.join("settings.json");
        fs::create_dir(&path).unwrap();

        let result = update_on_disk(&path, |settings| {
            settings.profile_name = "Overwritten".into();
            true
        });

        assert!(result.is_err());
        assert!(path.is_dir());
    }

    /// `closeToTray` (when written) wins over the retired dropdown, and an
    /// absent one defaults on.
    #[test]
    fn closes_to_tray_reads_the_boolean_with_the_dropdown_folded_in() {
        let cases: &[(&str, bool)] = &[
            (r#"{ "closeToTray": false }"#, false),
            (r#"{ "closeToTray": true }"#, true),
            ("{}", true),
            (r#"{ "onClose": "tray" }"#, true),
            (r#"{ "onClose": "quit" }"#, false),
            (r#"{ "onClose": "minimise" }"#, false),
            (r#"{ "closeToTray": true, "onClose": "quit" }"#, true),
        ];
        for (raw, expected) in cases {
            assert_eq!(load(raw).closes_to_tray(), *expected, "{raw}");
        }
    }

    #[test]
    fn discord_presence_is_on_unless_the_file_says_otherwise() {
        let cases: &[(&str, bool)] = &[
            (r#"{ "discordRichPresence": true }"#, true),
            (r#"{ "discordRichPresence": false }"#, false),
            // A file predating this setting entirely.
            ("{}", true),
        ];
        for (raw, expected) in cases {
            assert_eq!(load(raw).discord_presence_enabled(), *expected, "{raw}");
        }
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
    fn the_ui_scale_defaults_and_clamps_into_range() {
        assert_eq!(load("{}").scale(), DEFAULT_UI_SCALE);
        assert_eq!(load(r#"{ "uiScale": 0 }"#).scale(), 1.0);
        assert_eq!(load(r#"{ "uiScale": 9 }"#).scale(), MAX_UI_SCALE);
    }

    #[test]
    fn a_file_predating_the_theme_system_reads_as_the_built_in_default() {
        assert_eq!(load("{}").active_theme_id, None);
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
        assert!(
            parsed.discord_presence_enabled(),
            "an older file predating this setting must not read as opted out"
        );
    }
}
