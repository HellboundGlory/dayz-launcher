use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tetra_discord::{DiscordHandle, DiscordSession};
use tetra_net::prober::Prober;
use tetra_registry::Registry;
use tetra_steam::SteamHandle;

/// Application state managed by Tauri. See .ai-notes/src-tauri/src/state.rs.md
/// for the rationale behind each field.
pub struct AppState {
    pub registry: Mutex<Option<Registry>>,
    pub steam: Mutex<Option<Arc<SteamHandle>>>,
    pub prober: Mutex<Option<Prober>>,
    pub steam_ready: Mutex<bool>,
    /// Guards against two overlapping `steam_init` calls both starting Steam.
    pub steam_initialising: AtomicBool,
    /// Whether a `discover_servers` pass is mid-flight.
    pub discovery_running: AtomicBool,
    /// Set once `RunEvent::Exit` is handled, so in-flight discovery stops pulling.
    pub shutting_down: AtomicBool,
    /// Set when the on-disk registry failed to open and an in-memory one was substituted.
    pub registry_degraded: Mutex<bool>,
    /// Whether the close button hides to the tray instead of quitting.
    /// Mirrors `AppSettings::close_to_tray` for the window-event handler.
    pub close_to_tray: AtomicBool,
    /// Whether minimising hides to the tray instead of the taskbar. Mirrored for the same reason.
    pub minimise_to_tray: AtomicBool,
    /// The zoom factor currently applied to the webview, so `apply_ui_scale`
    /// can skip no-op re-applies.
    pub applied_ui_scale: Mutex<f64>,
    /// What the launcher does once DayZ is starting. Mirrored from `AppSettings::on_join`.
    pub on_join: Mutex<crate::commands::settings::OnJoin>,
    /// Window size/position/maximised state, kept current by move/resize
    /// handlers and flushed to settings.json once, at exit.
    pub window_state: Mutex<Option<crate::window_state::WindowState>>,
    /// The Discord Rich Presence connection, if started.
    pub discord: Mutex<Option<DiscordHandle>>,
    /// Mirror of `AppSettings::discord_rich_presence`, read by the poll loop.
    pub discord_enabled: AtomicBool,
    /// What `launch_game` is telling Discord right now, if anything.
    pub discord_now_playing: Mutex<Option<DiscordSession>>,
    /// The diagnostic log's open file handle, kept across calls. `None` means not-yet-opened.
    pub log_file: Mutex<Option<std::fs::File>>,
    /// Pooled, shared read connection for `commands::server::blocking_read`.
    pub server_reader: Mutex<Option<Arc<Mutex<tetra_registry::Reader>>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Mutex::new(None),
            steam: Mutex::new(None),
            prober: Mutex::new(None),
            steam_ready: Mutex::new(false),
            steam_initialising: AtomicBool::new(false),
            discovery_running: AtomicBool::new(false),
            shutting_down: AtomicBool::new(false),
            registry_degraded: Mutex::new(false),
            // False until `setup` overwrites from the settings file, so a close
            // during startup quits rather than hiding into a tray that may not exist yet.
            close_to_tray: AtomicBool::new(false),
            minimise_to_tray: AtomicBool::new(false),
            // NaN so the first real apply always goes through.
            applied_ui_scale: Mutex::new(f64::NAN),
            on_join: Mutex::new(crate::commands::settings::OnJoin::Stay),
            window_state: Mutex::new(None),
            discord: Mutex::new(None),
            discord_enabled: AtomicBool::new(true),
            discord_now_playing: Mutex::new(None),
            log_file: Mutex::new(None),
            server_reader: Mutex::new(None),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
