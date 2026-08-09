//! Tiny bridge so the frontend's diagnostics land in the same file logger as
//! the backend's — without a command the webview has no way to write a file.

use tauri::AppHandle;

/// Append `message` from the frontend to `tetra-launcher.log`, tagged
/// `[frontend]`. See `crate::log` for why the file exists.
#[tauri::command]
pub fn log_client(app: AppHandle, level: String, message: String) {
    crate::log::log_line(&app, &level, &format!("[frontend] {message}"));
}
