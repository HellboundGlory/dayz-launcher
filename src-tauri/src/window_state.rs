//! Remembering the window's size, position and maximised state.
//!
//! This replaces `tauri-plugin-window-state`, which was dropped for one
//! reason: it writes `.window-state.json` to `app_config_dir()` and only the
//! *filename* is configurable, not the directory. That single stray file was
//! the one thing standing between the launcher and keeping all of its data in
//! the directory [`crate::paths`] chooses. The geometry now lives in
//! `settings.json` as the `window` key.
//!
//! ## Where this runs
//!
//! The plugin restored geometry *before* `setup`, which is why the window is
//! configured `"visible": false` in `tauri.conf.json`. That contract is
//! unchanged: [`restore`] is called from `setup` before the window is shown,
//! so the saved size is applied to a window nobody has seen yet and there is
//! still no flash at the default size. `fit_window_to_minimum` continues to
//! run immediately afterwards, correcting a remembered window that is smaller
//! than the current interface scale allows.
//!
//! ## Why geometry is cached in memory and written once
//!
//! [`capture`] runs on every `Moved` and `Resized` event and only touches a
//! mutex — never the disk. The write happens once, at `RunEvent::Exit`.
//! Querying the window at exit instead would not work: quitting from the tray
//! quits while the window is hidden, and a hidden window's geometry is not
//! something to save.

use std::path::Path;
use tauri::{Manager, PhysicalPosition, PhysicalSize, Window};

/// The remembered geometry, stored under `window` in `settings.json`.
///
/// Physical pixels, matching what tao reports and what the retired plugin
/// wrote — so a `.window-state.json` from an older install deserialises into
/// this struct directly, extra keys and all.
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
///
/// The two guards are the ones that matter, and both are inherited from the
/// plugin's behaviour rather than invented:
///
/// - **Minimised windows are ignored entirely.** tao reports a minimise as a
///   resize to 0×0, and there is no `Minimized` event to filter on, so a naive
///   capture would remember a zero-sized window and restore it next launch as
///   a window that cannot be seen.
/// - **A maximised window updates only the flag.** Its size and position are
///   the screen's, not the user's; keeping the previous values is what makes
///   un-maximising restore the window someone actually chose.
pub fn capture(window: &Window, prev: Option<WindowState>) -> Option<WindowState> {
    let maximized = window.is_maximized().ok()?;
    if window.is_minimized().ok()? {
        return prev;
    }

    let mut next = prev.unwrap_or_default();
    next.maximized = maximized;

    // Nothing worth reading off a maximised window — but a first run that
    // starts maximised has no previous geometry either, and a stored 0×0 would
    // restore as an invisible window. Seed it from the window in that one case.
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

/// Apply remembered geometry to a window that has not been shown yet.
///
/// Failures are logged and swallowed throughout. A window that opens at its
/// default size is a cosmetic disappointment; refusing to start is not.
///
/// **Size and position only — maximising is [`restore_maximized`], called
/// later.** The two cannot happen together. `apply_ui_scale` runs between them
/// and calls `set_min_size`, which tao implements as a `SetWindowPos`; on a
/// maximised window that silently drops it out of the maximised state, as that
/// function's own documentation warns. Maximising here meant the window came
/// back the right *size* with `maximized` false, so the next exit recorded the
/// screen dimensions as if the user had chosen them, and un-maximising restored
/// a full-screen-sized window. The split is what keeps the flag honest.
pub fn restore(window: &Window, state: WindowState) {
    if state.width > 0 && state.height > 0 {
        let size = PhysicalSize::new(state.width, state.height);
        if let Err(e) = window.set_size(size) {
            eprintln!("[window] Could not restore the window size: {e}");
        }

        // **Only if the window would land on a monitor that still exists.**
        // Saved coordinates outlive the display they were saved on: undock a
        // laptop, unplug the second screen, or change the arrangement, and a
        // faithful restore puts the window somewhere nothing can reach it.
        // Letting the OS place it is the better failure.
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
///
/// Separate from [`restore`], and called after `apply_ui_scale` and
/// `fit_window_to_minimum` — see that function for why the order is
/// load-bearing. `fit_window_to_minimum` also returns early on a maximised
/// window, so it has to see the restored size before this runs, not after.
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
        // No monitor list is not evidence the position is bad. Honour it and
        // let the OS clamp, which is what happens without this check at all.
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

/// Read geometry out of a `.window-state.json` left by the retired plugin, and
/// delete it.
///
/// Called once, from `settings::load_at_startup`, and only when `settings.json`
/// has no `window` key of its own — so an upgrade keeps the window where the
/// user left it instead of resetting to the configured default. Deleting the
/// file is what stops this running again and what finally leaves one directory
/// with nothing stray in it.
pub fn adopt_legacy(dir: &Path) -> Option<WindowState> {
    let path = dir.join(crate::paths::LEGACY_WINDOW_STATE);
    let raw = std::fs::read_to_string(&path).ok()?;
    // `{ "main": { ... } }` — keyed by window label. Anything else is ignored
    // and the file still goes, since nothing will ever read it again.
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
