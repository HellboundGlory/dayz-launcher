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

/// Retired. Read once to migrate, never written.
///
/// A short-lived attempt to express close behaviour as one dropdown. It was the
/// wrong shape: tray-versus-taskbar is a property of *each* window button, not a
/// single choice between them, so "hide to the tray" and "minimise to the
/// taskbar" sat in one list looking like alternatives when the real question was
/// which button each applied to. Two independent checkboxes replaced it —
/// `minimise_to_tray` and `close_to_tray`.
///
/// It exists only because an unreleased debug build wrote `onClose` into a real
/// settings file. Nothing shipped with it, so this can go after one release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OnClose {
    Tray,
    Minimise,
    Quit,
}

/// Interface scale, as a webview zoom factor.
///
/// The floor is 1.0 because the app's type sizes are hard-coded in pixels
/// (`text-[10px]` and up) and were already at the edge of readable at 100%.
/// The ceiling is 1.5 because [`MIN_WINDOW`] is multiplied by this: much beyond
/// 1.5 and the smallest permitted window stops fitting on a 1080p screen.
pub const MIN_UI_SCALE: f64 = 1.0;
pub const MAX_UI_SCALE: f64 = 1.5;
pub const DEFAULT_UI_SCALE: f64 = 1.25;

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
    /// The close button hides the launcher to the tray instead of quitting.
    ///
    /// `Option` only so that "absent" is distinguishable from "chosen", which is
    /// what `migrate` needs to seed it from the retired `onClose`. Read it
    /// through [`AppSettings::closes_to_tray`] rather than unwrapping it.
    ///
    /// Mirrored into `AppState::close_to_tray`, which is what the window-event
    /// handler actually reads — see that field.
    pub close_to_tray: Option<bool>,
    /// The minimise button hides the launcher to the tray instead of putting it
    /// on the taskbar.
    ///
    /// Independent of `close_to_tray` on purpose. They are two different
    /// buttons, and wanting the launcher out of the taskbar while you play says
    /// nothing about whether closing it should quit.
    pub minimise_to_tray: bool,
    /// Retired in favour of the two booleans above; read once, never written.
    ///
    /// `skip_serializing` is what retires it: the value migrates an existing
    /// file, and the next save drops it. Deleting the field outright would have
    /// been silently wrong — serde ignores unknown keys, so a settings file
    /// carrying `"onClose": "quit"` would have parsed clean and then had
    /// close-to-tray switched back on underneath it.
    #[serde(skip_serializing)]
    pub on_close: Option<OnClose>,
    /// Interface scale, applied as a webview zoom factor.
    ///
    /// Defaults to 1.25 rather than 1.0, and deliberately applies to existing
    /// installs on upgrade: at 100% the launcher's 10–11px labels were too
    /// small to read comfortably, which is a defect rather than a preference
    /// someone opted into. Adjustable from the slider in the status bar.
    pub ui_scale: f64,
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
            // `None`, not `Some(true)`. The container's `#[serde(default)]`
            // fills an absent field from *here*, so a concrete value would make
            // "the file never had closeToTray" indistinguishable from "the user
            // chose it" — and the migration in `closes_to_tray` reads exactly
            // that distinction. The `true` default lives there instead.
            close_to_tray: None,
            // Off: the launcher disappearing from the taskbar is surprising
            // unless it was asked for.
            minimise_to_tray: false,
            on_close: None,
            ui_scale: DEFAULT_UI_SCALE,
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

impl AppSettings {
    /// Whether the close button hides to the tray, with the retired dropdown
    /// folded in.
    ///
    /// The one place `close_to_tray` is read. Everything else goes through here
    /// so there is no call site that could unwrap the `None` differently.
    pub fn closes_to_tray(&self) -> bool {
        self.close_to_tray.unwrap_or(match self.on_close {
            // The dropdown's two non-tray options both meant "do not hide".
            // `Minimise` is not lost — it becomes `minimise_to_tray: false`,
            // which is the same taskbar behaviour by the ordinary route.
            Some(OnClose::Minimise) | Some(OnClose::Quit) => false,
            // Either the dropdown's tray option, or a file predating all of
            // this — and hiding to the tray has been the default throughout.
            Some(OnClose::Tray) | None => true,
        })
    }

    /// The zoom factor to actually apply, with a hand-edited value brought back
    /// into range. A `0` in the file would otherwise collapse the window.
    pub fn scale(&self) -> f64 {
        if self.ui_scale.is_finite() {
            self.ui_scale.clamp(MIN_UI_SCALE, MAX_UI_SCALE)
        } else {
            DEFAULT_UI_SCALE
        }
    }

    /// Fold retired fields into their replacements, so everything downstream —
    /// including the frontend store — sees one canonical shape.
    fn migrate(&mut self) {
        self.close_to_tray = Some(self.closes_to_tray());
        self.on_close = None;
        self.ui_scale = self.scale();
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
    // On every path, including the defaults ones: `migrate` is what turns the
    // parse-time `None` that marks an absent `onClose` into the concrete value
    // the frontend store and the window handler both expect.
    settings.migrate();
    settings
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

/// The smallest window the layout is designed to survive, in CSS pixels at
/// 100% scale.
///
/// Width is set by the filter bar, which puts MAP/TAGS/REGION/PING and the
/// three HIDE toggles plus REFRESH on one row. Height is set by the details
/// panel's pinned regions — identity, stat cards, properties and the join
/// button — which do not scroll.
///
/// Mirrored by `minWidth`/`minHeight` in tauri.conf.json, which is the floor
/// tao applies before `setup` runs. `apply_ui_scale` then multiplies it. JSON
/// takes no comments, which is why the explanation lives here.
const MIN_WINDOW: (f64, f64) = (975.0, 620.0);

/// Apply the interface scale to the window: zoom the webview, and raise the
/// minimum window size to match.
///
/// The minimum has to move with the zoom. It is expressed in window pixels,
/// while every `min-w`/`min-h` in the layout is in CSS pixels, and zooming
/// divides one into the other — at 1.25 a 975px window gives the layout only
/// 780px to work with, which is narrower than the filter bar can render. Tying
/// the two together means the layout always gets [`MIN_WINDOW`] whatever the
/// slider says.
///
/// Both failures are logged and swallowed. A webview that will not zoom is a
/// launcher that looks wrong, not one that should refuse to open.
pub fn apply_ui_scale(app: &AppHandle, scale: f64) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(e) = window.set_zoom(scale) {
        eprintln!("[settings] Could not set interface scale to {scale}: {e}");
    }
    let min = tauri::LogicalSize::new(MIN_WINDOW.0 * scale, MIN_WINDOW.1 * scale);
    if let Err(e) = window.set_min_size(Some(min)) {
        eprintln!("[settings] Could not raise the minimum window size: {e}");
    }

    // A minimum constrains future sizing; it does not resize a window that is
    // already smaller. This runs after the window-state plugin has restored
    // saved geometry, so someone whose remembered window was near the old floor
    // would otherwise keep it and hand the layout less room than the floor
    // exists to guarantee — the one case raising the minimum was meant to cover.
    if let (Ok(size), Ok(factor)) = (window.inner_size(), window.scale_factor()) {
        let current = size.to_logical::<f64>(factor);
        if current.width < min.width || current.height < min.height {
            let grown = tauri::LogicalSize::new(
                current.width.max(min.width),
                current.height.max(min.height),
            );
            if let Err(e) = window.set_size(grown) {
                eprintln!("[settings] Could not grow the window to the minimum: {e}");
            } else {
                eprintln!(
                    "[settings] Window was {}x{}, grown to the {}x{} minimum",
                    current.width, current.height, grown.width, grown.height
                );
            }
        }
    }

    eprintln!(
        "[settings] Interface scale {scale}, minimum window {}x{}",
        min.width, min.height
    );
}

/// Apply the interface scale live, from the status-bar slider.
///
/// Separate from `save_settings` so dragging the slider is immediate rather
/// than one round trip through a settings write per pixel of travel. The
/// frontend persists the value once the drag ends.
#[tauri::command]
pub fn set_ui_scale(app: AppHandle, scale: f64) {
    let scale = if scale.is_finite() {
        scale.clamp(MIN_UI_SCALE, MAX_UI_SCALE)
    } else {
        DEFAULT_UI_SCALE
    };
    apply_ui_scale(&app, scale);
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
    apply_autostart(&app, settings.start_with_windows);
    // Idempotent when the slider already applied it live, and the one thing
    // that puts the scale back after a settings import or a hand-edited file.
    apply_ui_scale(&app, settings.scale());

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
    use super::{AppSettings, DEFAULT_UI_SCALE, MAX_UI_SCALE};

    /// Parse the way `read_from_disk` does — the migration is part of reading a
    /// file, not of deserialising the struct.
    fn load(raw: &str) -> AppSettings {
        let mut settings: AppSettings = serde_json::from_str(raw).expect("should parse");
        settings.migrate();
        settings
    }

    /// An explicit opt-out has to survive. Serde ignores unknown keys, so had
    /// `closeToTray` simply been deleted when the dropdown arrived, a file
    /// carrying `false` would have parsed clean and handed the user back the
    /// tray behaviour they had turned off.
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

    /// The dropdown existed only in an unreleased debug build, but it did write
    /// real settings files. Both of its non-tray options meant "closing should
    /// not hide me", so both come back as `false`.
    #[test]
    fn the_retired_dropdown_migrates_to_the_boolean() {
        assert!(load(r#"{ "onClose": "tray" }"#).closes_to_tray());
        assert!(!load(r#"{ "onClose": "quit" }"#).closes_to_tray());
        assert!(!load(r#"{ "onClose": "minimise" }"#).closes_to_tray());
    }

    /// The live field is the authority — a stale `onClose` left behind must not
    /// override a choice made since.
    #[test]
    fn close_to_tray_wins_over_the_retired_dropdown() {
        assert!(load(r#"{ "closeToTray": true, "onClose": "quit" }"#).closes_to_tray());
    }

    /// The retired field is read, never written. One save and it is gone from
    /// disk, which is what makes the migration a single-release affair.
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

    /// The two window behaviours are independent: hiding on minimise says
    /// nothing about what closing should do, and vice versa.
    #[test]
    fn minimise_and_close_to_tray_do_not_imply_each_other() {
        let settings = load(r#"{ "closeToTray": false, "minimiseToTray": true }"#);
        assert!(!settings.closes_to_tray());
        assert!(settings.minimise_to_tray);

        // Off by default — vanishing from the taskbar unasked is surprising.
        assert!(!load("{}").minimise_to_tray);
    }

    /// Existing installs get the larger interface, because 100% was too small
    /// to read rather than a preference anyone chose.
    #[test]
    fn a_file_predating_ui_scale_gets_the_new_default() {
        assert_eq!(load("{}").scale(), DEFAULT_UI_SCALE);
    }

    /// A hand-edited file must not be able to collapse the window or blow the
    /// minimum size past the screen.
    #[test]
    fn an_out_of_range_scale_is_clamped() {
        assert_eq!(load(r#"{ "uiScale": 0 }"#).scale(), 1.0);
        assert_eq!(load(r#"{ "uiScale": 9 }"#).scale(), MAX_UI_SCALE);
    }

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
