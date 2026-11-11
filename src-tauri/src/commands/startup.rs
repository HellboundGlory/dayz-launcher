use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::State;

#[derive(serde::Serialize)]
pub struct RegistryStatus {
    pub degraded: bool,
}

fn status_of(state: &AppState) -> Option<RegistryStatus> {
    (*state.registry_status.borrow()).map(|degraded| RegistryStatus { degraded })
}

/// `None` until setup has opened the registry.
#[tauri::command]
pub fn registry_status(state: State<AppState>) -> Option<RegistryStatus> {
    status_of(&state)
}

/// Whether the window was left in the tray by an OS autostart with start-minimised on.
#[tauri::command]
pub fn launched_hidden(state: State<AppState>) -> bool {
    state.launched_hidden.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_status_is_unknown_until_setup_reports_the_registry_and_then_carries_degraded() {
        let state = crate::state::AppState::new();
        assert!(super::status_of(&state).is_none());

        state.registry_status.send_replace(Some(true));

        assert!(super::status_of(&state).expect("a status").degraded);
    }
}
