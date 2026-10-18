use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::State;

#[derive(serde::Serialize)]
pub struct RegistryStatus {
    pub degraded: bool,
}

/// `None` until setup has opened the registry.
#[tauri::command]
pub fn registry_status(state: State<AppState>) -> Option<RegistryStatus> {
    state
        .registry_ready
        .get()
        .map(|&degraded| RegistryStatus { degraded })
}

/// Whether the window was left in the tray by an OS autostart with start-minimised on.
#[tauri::command]
pub fn launched_hidden(state: State<AppState>) -> bool {
    state.launched_hidden.load(Ordering::Relaxed)
}
