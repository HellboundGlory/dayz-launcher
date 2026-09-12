//! Theme commands: listing, reading, installing and deleting file-backed
//! themes, plus the one-time import of themes the frontend used to keep in
//! `localStorage`.
//!
//! All the storage rules live in [`crate::theme`]; these wrappers resolve the
//! themes directory, log what the storage layer chose to skip, and turn a
//! refusal into an `Err` the frontend can show. Nothing here panics on
//! disk content — an unreadable theme is a message in the log, never a crash.

use tauri::AppHandle;

use crate::theme::{self, LegacyTheme, ThemeFile, ThemeManifest, ThemeSummary};

/// Every installed theme, for the themes grid. A directory whose manifest is
/// missing, unreadable or corrupt is skipped and logged, not fatal.
#[tauri::command]
pub fn list_installed_themes(app: AppHandle) -> Vec<ThemeSummary> {
    let scan = theme::scan(&crate::paths::themes_dir(&app));
    for message in &scan.skipped {
        crate::log::log_line(&app, "theme", message);
    }
    scan.themes
}

/// One installed theme: its manifest plus the raw `tokens.json`.
#[tauri::command]
pub fn get_theme(app: AppHandle, id: String) -> Result<ThemeFile, String> {
    theme::get(&crate::paths::themes_dir(&app), &id)
}

/// Install a new theme. Create-only: an id that already has a directory is an
/// error, so an install can never overwrite a theme in place.
#[tauri::command]
pub fn save_theme(
    app: AppHandle,
    manifest: ThemeManifest,
    tokens: serde_json::Value,
) -> Result<String, String> {
    let id = theme::save(&crate::paths::themes_dir(&app), &manifest, &tokens)?;
    crate::log::log_line(&app, "theme", &format!("Installed theme `{id}`"));
    Ok(id)
}

/// Delete an installed theme. Refuses the active theme (switch away first) and
/// any id with no directory — built-in presets are not deletable this way.
#[tauri::command]
pub fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    let active = crate::commands::settings::current(&app).active_theme_id;
    theme::delete(&crate::paths::themes_dir(&app), &id, active.as_deref())?;
    crate::log::log_line(&app, "theme", &format!("Deleted theme `{id}`"));
    Ok(())
}

/// Record which theme is active. Any id is accepted — built-in or file-backed;
/// only the frontend knows which is which.
#[tauri::command]
pub fn set_active_theme_id(app: AppHandle, id: Option<String>) -> Result<(), String> {
    crate::commands::settings::set_active_theme_id(&app, id)
}

/// Import themes saved by an older build in the frontend's `localStorage`,
/// writing one directory each. Returns the ids created, in input order, so the
/// caller can remap a saved selection onto them.
#[tauri::command]
pub fn migrate_legacy_custom_themes(app: AppHandle, legacy: Vec<LegacyTheme>) -> Vec<String> {
    let migration = theme::migrate(&crate::paths::themes_dir(&app), &legacy);
    for message in &migration.skipped {
        crate::log::log_line(
            &app,
            "theme",
            &format!("Legacy theme not migrated — {message}"),
        );
    }
    if !migration.migrated.is_empty() {
        crate::log::log_line(
            &app,
            "theme",
            &format!("Migrated {} saved theme(s)", migration.migrated.len()),
        );
    }
    migration.migrated
}
