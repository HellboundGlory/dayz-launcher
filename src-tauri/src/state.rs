use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
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
    /// Set when the on-disk registry could not be opened and an in-memory one
    /// was substituted. Everything works, but nothing survives a restart, so
    /// the frontend warns rather than letting the user find out by losing
    /// their favourites.
    pub registry_degraded: Mutex<bool>,
    /// Whether closing the window hides to the tray instead of quitting.
    ///
    /// A mirror of `AppSettings::close_to_tray`, which is otherwise only ever
    /// on disk and in the frontend store. The window-event handler has to
    /// answer "hide or quit?" synchronously, inside a callback that has no
    /// access to the frontend and no business doing file I/O, so the flag is
    /// seeded at startup and re-published by `save_settings` on every write.
    pub close_to_tray: AtomicBool,
    /// What the launcher does with itself once DayZ is starting.
    ///
    /// Mirrored from `AppSettings::on_join` for the same reason as
    /// `close_to_tray`: `launch_game` runs in Rust and has no way to ask the
    /// frontend store what the user chose.
    pub on_join: Mutex<crate::commands::settings::OnJoin>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Mutex::new(None),
            steam: Mutex::new(None),
            prober: Mutex::new(None),
            steam_ready: Mutex::new(false),
            registry_degraded: Mutex::new(false),
            // Overwritten from the settings file in `setup` before the window
            // can be closed. `false` until then, so a close during startup
            // quits rather than hiding into a tray that may not exist yet.
            close_to_tray: AtomicBool::new(false),
            on_join: Mutex::new(crate::commands::settings::OnJoin::Stay),
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
