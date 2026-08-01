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
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Mutex::new(None),
            steam: Mutex::new(None),
            prober: Mutex::new(None),
            steam_ready: Mutex::new(false),
        }
    }
}