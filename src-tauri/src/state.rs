use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tetra_discord::{DiscordHandle, DiscordSession};
use tetra_net::prober::Prober;
use tetra_registry::Registry;
use tetra_steam::SteamHandle;

/// Application state managed by Tauri.
/// Follows TetraLauncher's pattern from `crates/tetra-scan/src/main.rs`.
///
/// `SteamHandle` is in an `Arc` because it cannot be cloned (it holds a
/// `JoinHandle`), and Tauri commands need `'static` references for
/// `spawn_blocking`.
pub struct AppState {
    pub registry: Mutex<Option<Registry>>,
    pub steam: Mutex<Option<Arc<SteamHandle>>>,
    pub prober: Mutex<Option<Prober>>,
    pub steam_ready: Mutex<bool>,
    /// Guards against two overlapping `steam_init` calls both running a real
    /// `SteamAPI_Init()` (M17, 2026-08-29 audit) — see `commands::steam::steam_init`.
    /// `steam_ready` alone wasn't enough: it's only checked *before* the slow
    /// `SteamHandle::start()` call, so two calls arriving close together (the
    /// auto-retry timer and a manual Retry click, say) could both pass that
    /// check and both start a Steam session before either finished.
    pub steam_initialising: AtomicBool,
    /// Whether a `discover_servers` pass is mid-flight. Logged at exit so a
    /// report can tell whether Steam was still streaming when the process
    /// ended (one of the aggravators behind the Linux exit-time crash).
    pub discovery_running: AtomicBool,
    /// Set the moment `RunEvent::Exit` is handled. `discover_servers` checks it
    /// between stream batches and stops pulling, so Steam teardown at exit
    /// isn't left waiting for an in-flight server-list request.
    pub shutting_down: AtomicBool,
    /// Set when the on-disk registry could not be opened and an in-memory one
    /// was substituted. Everything works, but nothing survives a restart, so
    /// the frontend warns rather than letting the user find out by losing
    /// their favourites.
    pub registry_degraded: Mutex<bool>,
    /// Whether the close button hides to the tray instead of quitting.
    ///
    /// A mirror of `AppSettings::close_to_tray`, which is otherwise only ever
    /// on disk and in the frontend store. The window-event handler has to
    /// answer "hide or quit?" synchronously, inside a callback that has no
    /// access to the frontend and no business doing file I/O, so the flag is
    /// seeded at startup and re-published by `save_settings` on every write.
    pub close_to_tray: AtomicBool,
    /// Whether minimising hides to the tray instead of the taskbar. Mirrored
    /// for the same reason, and read from the resize handler — which fires
    /// often enough that an atomic load matters.
    pub minimise_to_tray: AtomicBool,
    /// The zoom factor currently applied to the webview.
    ///
    /// Exists so `apply_ui_scale` can tell a real change from the many
    /// no-op calls it gets: `save_settings` runs it on every write, and the
    /// frontend saves after *any* setting changes. Re-applying was not free —
    /// `set_min_size` knocks a maximised window out of maximised.
    pub applied_ui_scale: Mutex<f64>,
    /// What the launcher does with itself once DayZ is starting.
    ///
    /// Mirrored from `AppSettings::on_join` for the same reason as
    /// `close_to_tray`: `launch_game` runs in Rust and has no way to ask the
    /// frontend store what the user chose.
    pub on_join: Mutex<crate::commands::settings::OnJoin>,
    /// The window's size, position and maximised state, kept current by the
    /// move and resize handlers and written to `settings.json` once, at exit.
    ///
    /// In memory rather than straight to disk because those events fire
    /// continuously through a drag. Cached rather than read off the window at
    /// exit because quitting from the tray quits while the window is hidden —
    /// see `crate::window_state`.
    pub window_state: Mutex<Option<crate::window_state::WindowState>>,
    /// The Discord Rich Presence connection, started only if
    /// `AppSettings::discord_rich_presence` allows it — `None` means either
    /// "not started yet" or "the user has never enabled it this session".
    /// See `crate::discord`.
    pub discord: Mutex<Option<DiscordHandle>>,
    /// Mirror of `AppSettings::discord_rich_presence`, read by the poll loop
    /// for the same reason `close_to_tray` is mirrored: the loop runs outside
    /// any command and has no way to ask the frontend store.
    pub discord_enabled: AtomicBool,
    /// What `launch_game` is telling Discord right now — the pre-launch mod
    /// gate running, or a live session — if anything. Set by `launch_game`;
    /// cleared either by `launch_game` itself (a failed gate must not strand
    /// Discord on "Checking mods") or by the poll loop once
    /// `tetra_launch::running::dayz_is_running` reports a live session ended.
    pub discord_now_playing: Mutex<Option<DiscordSession>>,
    /// The diagnostic log's open file handle, kept across calls instead of
    /// opened-appended-closed per line — see `crate::log`. `None` means "not
    /// opened yet" or "the last write left it in a bad state and it needs
    /// reopening".
    pub log_file: Mutex<Option<std::fs::File>>,
    /// A pooled, shared read connection for `commands::server::blocking_read`
    /// (M1, 2026-08-29 audit) — every call used to open, `PRAGMA`-configure
    /// and register two scalar UDFs on a brand-new `Connection`, on the
    /// hottest path in the app (`get_server_list`, up to four times a second
    /// during discovery). Lazily seeded by
    /// `commands::server::reader_pool` on first use rather than at setup, so
    /// nothing has to assume setup has run yet. `Arc` so a clone of it — not a
    /// borrow of `AppState` — is what gets moved into `spawn_blocking`.
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
            // Both overwritten from the settings file in `setup` before the
            // window can be closed or minimised. `false` until then, so a close
            // during startup quits rather than hiding into a tray that may not
            // exist yet.
            close_to_tray: AtomicBool::new(false),
            minimise_to_tray: AtomicBool::new(false),
            // Not any valid scale, so the first application always goes through
            // however the settings file happens to be configured.
            applied_ui_scale: Mutex::new(f64::NAN),
            on_join: Mutex::new(crate::commands::settings::OnJoin::Stay),
            // Seeded from the settings file in `setup`, so a session that
            // never moves the window still writes back what it restored.
            window_state: Mutex::new(None),
            discord: Mutex::new(None),
            // Overwritten from the settings file in `setup`, same as
            // `close_to_tray` above. Defaults on so the flag is never
            // accidentally "disabled" if setup somehow doesn't run.
            discord_enabled: AtomicBool::new(true),
            discord_now_playing: Mutex::new(None),
            log_file: Mutex::new(None),
            server_reader: Mutex::new(None),
        }
    }
}

// Tauri constructs this once via `Builder::manage`; `Default` exists because a
// `new()` with no arguments and no `Default` is a clippy lint and a papercut for
// anyone writing a test fixture.
impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
