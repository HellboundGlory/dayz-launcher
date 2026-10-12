//! Tiny bridge so the frontend's diagnostics land in the same file logger as
//! the backend's — without a command the webview has no way to write a file.

use tauri::AppHandle;

/// Append `message` from the frontend to `tetra-launcher.log`, tagged `[frontend]`.
/// `verbose` routes hot-path lines through `log_line_verbose`, debug-build only.
#[tauri::command]
pub fn log_client(app: AppHandle, level: String, message: String, verbose: Option<bool>) {
    let msg = format!("[frontend] {message}");
    if verbose.unwrap_or(false) {
        crate::log::log_line_verbose(&app, &level, &msg);
    } else {
        crate::log::log_line(&app, &level, &msg);
    }
}
