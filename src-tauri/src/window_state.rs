//! Remembering the window's size, position and maximised state, replacing
//! `tauri-plugin-window-state` so geometry lives in `settings.json` instead
//! of a stray file. [`restore`] runs from `setup` before the window is
//! shown; [`capture`] just updates an in-memory cache, written once at exit.
//! See .ai-notes/src-tauri/src/window_state.rs.md for the full ordering rationale.

use std::path::Path;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Window};

/// The remembered geometry, stored under `window` in `settings.json`.
/// Physical pixels, matching what tao reports and the retired plugin wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

/// Fold the current window geometry into `prev`, returning the value to cache.
/// Minimised windows are ignored (tao reports minimise as a 0x0 resize), and
/// a maximised window only updates the flag, not size/position.
pub fn capture(window: &Window, prev: Option<WindowState>) -> Option<WindowState> {
    let maximized = window.is_maximized().ok()?;
    if window.is_minimized().ok()? {
        return prev;
    }

    let mut next = prev.unwrap_or_default();
    next.maximized = maximized;

    // Seed from the window on first run even if maximised, so a stored 0x0
    // doesn't restore as invisible.
    if !maximized || prev.is_none() {
        if let Ok(size) = window.inner_size() {
            if size.width > 0 && size.height > 0 {
                next.width = size.width;
                next.height = size.height;
            }
        }
        if let Ok(position) = window.outer_position() {
            next.x = position.x;
            next.y = position.y;
        }
    }

    Some(next)
}

/// Apply remembered size/position to a window not yet shown. Maximising is
/// separate — [`restore_maximized`], called after `apply_ui_scale`'s
/// `set_min_size` (which would otherwise un-maximise here).
pub fn restore(window: &Window, state: WindowState) {
    if state.width > 0 && state.height > 0 {
        let size = PhysicalSize::new(state.width, state.height);
        if let Err(e) = window.set_size(size) {
            eprintln!("[window] Could not restore the window size: {e}");
        }

        // Only restore position if it still lands on a connected monitor —
        // saved coordinates can outlive the display they were saved on.
        let position = PhysicalPosition::new(state.x, state.y);
        if on_a_connected_monitor(window, position, size) {
            if let Err(e) = window.set_position(position) {
                eprintln!("[window] Could not restore the window position: {e}");
            }
        } else {
            eprintln!(
                "[window] Saved position {},{} is off every connected monitor; \
                 letting the OS place the window.",
                state.x, state.y
            );
        }
    }
}

/// Maximise a window whose size and position have already been restored.
/// Called after `apply_ui_scale` and `fit_window_to_minimum` — order matters, see [`restore`].
pub fn restore_maximized(window: &Window) {
    if let Err(e) = window.maximize() {
        eprintln!("[window] Could not restore the maximised state: {e}");
    }
}

/// Whether any corner of the proposed rectangle falls inside a monitor that is
/// currently attached.
fn on_a_connected_monitor(
    window: &Window,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return true;
    };
    let corners = [
        (position.x, position.y),
        (position.x + size.width as i32, position.y),
        (position.x, position.y + size.height as i32),
        (
            position.x + size.width as i32,
            position.y + size.height as i32,
        ),
    ];
    monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let extent = monitor.size();
        let (left, top) = (origin.x, origin.y);
        let right = left + extent.width as i32;
        let bottom = top + extent.height as i32;
        corners
            .iter()
            .any(|(x, y)| *x >= left && *x < right && *y >= top && *y < bottom)
    })
}

/// Read geometry out of a `.window-state.json` left by the retired plugin,
/// and delete it. Called once from `settings::load_at_startup`, only when
/// `settings.json` has no `window` key yet.
pub fn adopt_legacy(dir: &Path) -> Option<WindowState> {
    let path = dir.join(crate::paths::LEGACY_WINDOW_STATE);
    let raw = std::fs::read_to_string(&path).ok()?;
    // Keyed by window label; only "main" is used.
    let parsed = serde_json::from_str::<std::collections::HashMap<String, WindowState>>(&raw);
    let adopted = parsed.ok().and_then(|windows| windows.get("main").copied());

    if let Err(e) = std::fs::remove_file(&path) {
        eprintln!("[window] Could not remove {}: {e}", path.display());
    }
    match adopted {
        Some(state) => {
            eprintln!(
                "[window] Adopted window geometry from the retired {} file",
                crate::paths::LEGACY_WINDOW_STATE
            );
            Some(state)
        }
        None => None,
    }
}

/// The cached geometry for the main window, or `None` if nothing has been
/// captured yet.
pub fn cached(app: &tauri::AppHandle) -> Option<WindowState> {
    let state = app.try_state::<crate::state::AppState>()?;
    let guard = state.window_state.lock().ok()?;
    *guard
}

/// Record the main window's current geometry in the cache. Cheap enough to run
/// on every move and resize — one window query and one mutex, no I/O.
pub fn remember(window: &Window) {
    let app = window.app_handle();
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let Ok(mut guard) = state.window_state.lock() else {
        return;
    };
    if let Some(next) = capture(window, *guard) {
        *guard = Some(next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-window-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The shape the retired plugin actually wrote: extra keys we no longer
    /// carry, keyed by window label.
    #[test]
    fn a_plugin_written_file_is_adopted_and_removed() {
        let dir = scratch("adopt");
        std::fs::write(
            dir.join(crate::paths::LEGACY_WINDOW_STATE),
            r#"{"main":{"width":1600,"height":900,"x":120,"y":80,"prev_x":0,
               "prev_y":0,"maximized":true,"visible":true,"decorated":false,
               "fullscreen":false}}"#,
        )
        .unwrap();

        let adopted = adopt_legacy(&dir).expect("should have adopted the main window");

        assert_eq!(adopted.width, 1600);
        assert_eq!(adopted.height, 900);
        assert_eq!(adopted.x, 120);
        assert_eq!(adopted.y, 80);
        assert!(adopted.maximized);
        assert!(
            !dir.join(crate::paths::LEGACY_WINDOW_STATE).exists(),
            "the file must not survive to be adopted twice"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_legacy_file_is_the_ordinary_case_not_an_error() {
        let dir = scratch("absent");
        assert_eq!(adopt_legacy(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A corrupt file must still be cleared, or it is re-read on every start.
    #[test]
    fn an_unparseable_legacy_file_is_dropped_without_a_value() {
        let dir = scratch("corrupt");
        let path = dir.join(crate::paths::LEGACY_WINDOW_STATE);
        std::fs::write(&path, "{ not json").unwrap();

        assert_eq!(adopt_legacy(&dir), None);
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn geometry_round_trips_through_the_settings_representation() {
        let state = WindowState {
            width: 1400,
            height: 800,
            x: -12,
            y: 40,
            maximized: false,
        };
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(serde_json::from_str::<WindowState>(&json).unwrap(), state);
    }
}
