//! Theme commands: list/read/install/delete file-backed themes, plus the
//! legacy `localStorage` import and copying an installed theme. Storage rules
//! live in [`crate::theme`]; these wrappers resolve the themes directory and
//! log what got skipped.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::PendingActivation;
use crate::theme::validator::{self, Severity, ValidationIssue};
use crate::theme::{self, LegacyTheme, ThemeFile, ThemeManifest, ThemeSummary};

/// Every installed theme, for the themes grid. A directory whose manifest is
/// missing, unreadable or corrupt is skipped and logged, not fatal.
#[tauri::command]
pub fn list_installed_themes(app: AppHandle) -> Vec<ThemeSummary> {
    seed_builtin_themes(&app);
    let scan = theme::scan(&crate::paths::themes_dir(&app));
    for message in &scan.skipped {
        crate::log::log_line(&app, "theme", message);
    }
    scan.themes
}

/// One installed theme: its manifest plus the raw `tokens.json`.
#[tauri::command]
pub fn get_theme(app: AppHandle, id: String) -> Result<ThemeFile, String> {
    seed_builtin_themes(&app);
    theme::get(&crate::paths::themes_dir(&app), &id)
}

/// Run the v2 validators against every file an installed theme ships, for Dev
/// Mode's validation panel. Order: layout issues, then settings, then CSS.
#[tauri::command]
pub fn validate_theme(app: AppHandle, id: String) -> Result<Vec<ValidationIssue>, String> {
    validate_theme_at(&crate::paths::themes_dir(&app), &id)
}

/// [`validate_theme`]'s body, taking a plain root so it is testable against a
/// scratch directory instead of a live `AppHandle`.
fn validate_theme_at(themes_root: &Path, id: &str) -> Result<Vec<ValidationIssue>, String> {
    if !theme::is_usable_id(id) {
        return Err(format!(
            "`{id}` is not a usable theme id — it must be a single directory name"
        ));
    }
    let dir = themes_root.join(id);
    if !dir.is_dir() {
        return Err(format!("No installed theme `{id}` at {}", dir.display()));
    }

    let (schema, settings_issues) = validate_theme_settings(&dir)?;
    let (_, mut issues) = theme::read_and_validate_layouts(&dir, schema.as_ref())?;
    issues.extend(settings_issues);
    issues.extend(validate_theme_styles(&dir)?);
    Ok(issues)
}

/// `settings.schema.json` as resolved, when the theme ships one, with its issues.
/// A parse failure is reported as a SET-01 issue rather than failing the whole
/// command, matching how a malformed layout file is handled.
fn validate_theme_settings(
    dir: &Path,
) -> Result<
    (
        Option<validator::settings::ResolvedSettings>,
        Vec<ValidationIssue>,
    ),
    String,
> {
    let path = dir.join(theme::SETTINGS_SCHEMA_FILE);
    if !path.is_file() {
        return Ok((None, Vec::new()));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(value) => {
            let (settings, issues) = validator::settings::resolve_settings_with_issues(&value);
            Ok((Some(settings), issues))
        }
        Err(error) => Ok((
            None,
            vec![ValidationIssue {
                rule_id: "SET-01".into(),
                severity: Severity::Error,
                file: theme::SETTINGS_SCHEMA_FILE.into(),
                pointer: String::new(),
                message: format!("Invalid settings.schema.json: {error}"),
                hint: None,
            }],
        )),
    }
}

/// `styles.css`, when the theme ships one.
fn validate_theme_styles(dir: &Path) -> Result<Vec<ValidationIssue>, String> {
    let path = dir.join(theme::STYLES_FILE);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let source = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    Ok(validator::validate_css_stylesheet(
        theme::STYLES_FILE,
        &source,
    ))
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

/// Rewrite an installed user theme's palette in place — SPEC §4.6's save for
/// the active theme. Only `local.*` ids qualify; see [`theme::update_tokens`].
#[tauri::command]
pub fn update_theme_tokens(
    app: AppHandle,
    id: String,
    tokens: serde_json::Value,
) -> Result<(), String> {
    theme::update_tokens(&crate::paths::themes_dir(&app), &id, &tokens)?;
    crate::log::log_line(&app, "theme", &format!("Updated tokens for theme `{id}`"));
    Ok(())
}

/// Delete an installed theme. Refuses the active theme (switch away first),
/// any `builtin.*` id, and any id with no directory — built-in presets are not
/// deletable this way.
#[tauri::command]
pub fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    let active = crate::commands::settings::current(&app).active_theme_id;
    theme::delete(&crate::paths::themes_dir(&app), &id, active.as_deref())?;
    crate::log::log_line(&app, "theme", &format!("Deleted theme `{id}`"));
    Ok(())
}

/// The end user's tuned `settings.schema.json` values for one installed theme.
/// `{}` when nothing has been tuned yet — absence is not an error.
#[tauri::command]
pub fn get_theme_settings_values(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    theme::settings_values::get_values(&crate::paths::themes_dir(&app), &id)
}

/// Tune one field of one installed theme, keeping every other tuned value.
#[tauri::command]
pub fn set_theme_settings_value(
    app: AppHandle,
    id: String,
    field_id: String,
    value: serde_json::Value,
) -> Result<(), String> {
    theme::settings_values::set_value(&crate::paths::themes_dir(&app), &id, &field_id, &value)?;
    crate::log::log_line(&app, "theme", &format!("Set `{field_id}` for theme `{id}`"));
    Ok(())
}

/// Validate a theme `.zip` and stage it for confirmation. Nothing is
/// installed yet; see [`theme::archive`] for the checks and their order.
#[tauri::command]
pub fn import_theme_preview(
    app: AppHandle,
    zip_path: String,
) -> Result<theme::archive::ThemeImportPreview, String> {
    let themes_root = crate::paths::themes_dir(&app);
    let installed = theme::scan(&themes_root).themes;
    theme::archive::stage_for_preview(&themes_root, std::path::Path::new(&zip_path), &installed)
}

/// Move a validated staging directory into the live themes tree, replacing an
/// installed theme with the same id. The only step that writes a theme in place.
#[tauri::command]
pub fn confirm_theme_install(app: AppHandle, staging_id: String) -> Result<String, String> {
    let themes_root = crate::paths::themes_dir(&app);
    let id = theme::archive::confirm_theme_install(&themes_root, &staging_id)?;
    crate::log::log_line(
        &app,
        "theme",
        &format!("Installed theme `{id}` from import"),
    );
    Ok(id)
}

/// Discard a staged import the user did not install, removing its staging directory.
#[tauri::command]
pub fn discard_theme_import(app: AppHandle, staging_id: String) -> Result<(), String> {
    theme::archive::discard_theme_import(&crate::paths::themes_dir(&app), &staging_id)
}

/// Package an installed theme to `dest_path`, applying the dialog's overrides.
/// Nothing is written until every check passes.
#[tauri::command]
pub fn export_theme(
    app: AppHandle,
    id: String,
    manifest_overrides: theme::archive::ManifestOverrides,
    dest_path: String,
) -> Result<(), String> {
    let themes_root = crate::paths::themes_dir(&app);
    let dest_path = std::path::Path::new(&dest_path);
    theme::archive::export(
        &themes_root,
        &id,
        &manifest_overrides,
        &crate::paths::data_root(&app),
        dest_path,
    )?;
    crate::log::log_line(&app, "theme", &format!("Exported theme `{id}`"));
    Ok(())
}

/// Record which theme is active. Any id is accepted — built-in or file-backed;
/// only the frontend knows which is which.
#[tauri::command]
pub fn set_active_theme_id(app: AppHandle, id: Option<String>) -> Result<(), String> {
    crate::commands::settings::set_active_theme_id(&app, id)
}

/// Import themes saved by an older build in the frontend's `localStorage`,
/// writing one directory each. Returns one entry per theme, in input order: the
/// id it was written as, or `None` when it was skipped, so a saved selection can
/// be remapped by position.
#[tauri::command]
pub fn migrate_legacy_custom_themes(
    app: AppHandle,
    legacy: Vec<LegacyTheme>,
) -> Vec<Option<String>> {
    let migration = theme::migrate(&crate::paths::themes_dir(&app), &legacy);
    for message in &migration.skipped {
        crate::log::log_line(
            &app,
            "theme",
            &format!("Legacy theme not migrated — {message}"),
        );
    }
    let written = migration.migrated.iter().filter(|id| id.is_some()).count();
    if written > 0 {
        crate::log::log_line(&app, "theme", &format!("Migrated {written} saved theme(s)"));
    }
    migration.migrated
}

// ── Theme Activation Safety Window ──────────────────────────────────────────
//
// A theme switch is applied live in the frontend and would otherwise be
// permanent even if the new palette makes the app unusable. `arm_activation`
// shows a theme-independent guard window and remembers the outgoing theme in
// memory, writing nothing; only `confirm_activation` touches `settings.json`.
// `revert_activation` (explicit, or the backend timer on expiry) throws the
// switch away and tells `main` to restore the old theme.

/// Long enough to read the window and click; short enough that a wedged
/// frontend can't strand the app on an unusable palette.
const ACTIVATION_WINDOW: Duration = Duration::from_secs(15);

/// Must agree with the window label in `tauri.conf.json` and `capabilities/theme-guard.json`.
const GUARD_WINDOW: &str = "theme-guard";

/// Mirrors `tauri.conf.json`'s `width`/`height`; used only by the first-use lazy build.
const GUARD_SIZE: (f64, f64) = (336.0, 116.0);

impl PendingActivation {
    /// `saturating_` so a poll landing after the deadline reads `0` instead of underflowing.
    fn remaining_ms(&self, now: Instant) -> u64 {
        self.deadline
            .saturating_duration_since(now)
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
}

/// `remainingMs` is computed fresh per call from the stored deadline, never
/// stored as a countdown — a stored one would drift and freeze across OS suspend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationStatus {
    previous_id: Option<String>,
    new_id: Option<String>,
    remaining_ms: u64,
}

impl ActivationStatus {
    fn of(pending: &PendingActivation, now: Instant) -> Self {
        Self {
            previous_id: pending.previous_id.clone(),
            new_id: pending.new_id.clone(),
            remaining_ms: pending.remaining_ms(now),
        }
    }
}

fn is_live(pending: &PendingActivation, now: Instant) -> bool {
    pending.deadline > now
}

/// `Some` whenever something is armed, expired or not — an expired one reports
/// `remainingMs: 0` rather than disappearing, so the frontend can tell
/// "counting down" from "expired". Read-only: the caller decides the outcome.
fn read(pending: &Option<PendingActivation>, now: Instant) -> Option<ActivationStatus> {
    pending.as_ref().map(|p| ActivationStatus::of(p, now))
}

/// For [`confirm_activation`] only: refuses an expired activation, which would
/// otherwise race the timer's revert.
fn take_if_live(
    subject: &mut Option<PendingActivation>,
    now: Instant,
) -> Option<PendingActivation> {
    match subject.as_ref() {
        Some(pending) if is_live(pending, now) => subject.take(),
        _ => None,
    }
}

/// For the expiry timer: takes only an expired activation. A re-armed one has
/// a later deadline, so the timer for the displaced one finds it live and does nothing.
fn take_if_expired(
    subject: &mut Option<PendingActivation>,
    now: Instant,
) -> Option<PendingActivation> {
    match subject.as_ref() {
        Some(pending) if !is_live(pending, now) => subject.take(),
        _ => None,
    }
}

/// For [`revert_activation`], which must succeed on an expired activation too,
/// since the frontend's revert at zero can arrive after the timer's.
fn take_any(subject: &mut Option<PendingActivation>) -> Option<PendingActivation> {
    subject.take()
}

/// Arm (or re-arm) the pending activation. Re-arming replaces whatever was
/// pending and restarts the clock. Returns what was displaced, if anything,
/// so the caller can clean up an abandoned duplicate.
fn arm(
    subject: &mut Option<PendingActivation>,
    previous_id: Option<String>,
    new_id: Option<String>,
    delete_on_revert: bool,
    at: Instant,
) -> Option<PendingActivation> {
    subject.replace(PendingActivation {
        previous_id,
        new_id,
        delete_on_revert,
        deadline: at + ACTIVATION_WINDOW,
    })
}

/// Throw away a taken activation: tell `main` to restore the old theme, log it,
/// and clean up an orphaned duplicate.
fn finish_revert(app: &AppHandle, pending: &PendingActivation) {
    let _ = app.emit("theme-activation-reverted", reverted_payload(pending));
    crate::log::log_line(
        app,
        "theme",
        &format!("Reverted theme activation to {:?}", pending.previous_id),
    );
    delete_orphaned_duplicate(app, pending);
}

/// Revert at the deadline even when the guard window never showed or has
/// crashed. A stale timer finds nothing expired and does nothing.
fn spawn_expiry(app: &AppHandle, deadline: Instant) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)).await;
        let expired = {
            let state = app.state::<crate::state::AppState>();
            let Ok(mut slot) = state.pending_theme.lock() else {
                return;
            };
            take_if_expired(&mut slot, Instant::now())
        };
        if let Some(pending) = expired {
            finish_revert(&app, &pending);
            hide_guard_window(&app);
        }
    });
}

/// Best-effort: never fails the caller — losing the cleanup is better than
/// losing the activation outcome it rides along with.
fn delete_orphaned_duplicate(app: &AppHandle, pending: &PendingActivation) {
    if !pending.delete_on_revert {
        return;
    }
    let Some(id) = &pending.new_id else { return };
    let themes_root = crate::paths::themes_dir(app);
    match theme::delete(&themes_root, id, None) {
        Ok(()) => crate::log::log_line(app, "theme", &format!("Deleted abandoned theme `{id}`")),
        Err(e) => crate::log::log_line(
            app,
            "theme",
            &format!("Could not delete abandoned theme `{id}`: {e}"),
        ),
    }
}

fn guard_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(GUARD_WINDOW)
}

/// Built lazily on first activation, from the same properties as its
/// `tauri.conf.json` entry — a self-contained page with no stylesheet or
/// `data-tetra-slot`, so it renders identically under every theme.
fn build_guard_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    tauri::WebviewWindowBuilder::new(
        app,
        GUARD_WINDOW,
        tauri::WebviewUrl::App("theme-guard.html".into()),
    )
    .title("Tetra Launcher")
    .inner_size(GUARD_SIZE.0, GUARD_SIZE.1)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .build()
    .map_err(|e| format!("Could not open the theme guard window: {e}"))
}

/// Center the guard window over the main window, like every other modal.
/// Recomputed on every show since the main window can have moved. Relies on
/// `outer_position()`, which native Wayland can't expose (protocol
/// limitation) — silently no-ops there.
fn center_over_main(app: &AppHandle, guard: &tauri::WebviewWindow) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(main_pos), Ok(main_size), Ok(guard_size)) =
        (main.outer_position(), main.outer_size(), guard.outer_size())
    else {
        return;
    };
    let x = main_pos.x + (main_size.width as i32 - guard_size.width as i32) / 2;
    let y = main_pos.y + (main_size.height as i32 - guard_size.height as i32) / 2;
    let _ = guard.set_position(tauri::PhysicalPosition::new(x, y));
}

/// Both the config and the lazy build start the window hidden, so this
/// explicit `show` is required either way.
fn show_guard_window(app: &AppHandle) -> Result<(), String> {
    let window = match guard_window(app) {
        Some(window) => window,
        None => build_guard_window(app)?,
    };
    center_over_main(app, &window);
    window
        .show()
        .map_err(|e| format!("Could not show the theme guard window: {e}"))
}

/// No window (never armed this session) or an already-hidden one are both fine, not errors.
fn hide_guard_window(app: &AppHandle) {
    if let Some(window) = guard_window(app) {
        let _ = window.hide();
    }
}

/// Begin a theme activation: remember the outgoing theme and show the guard
/// window, writing nothing to disk — the frontend has already applied
/// `new_id` live. `delete_on_revert` is true for a theme this same action
/// just created (duplicate, "New theme") and never kept — see
/// [`delete_orphaned_duplicate`].
#[tauri::command]
pub fn arm_activation(
    app: AppHandle,
    new_id: Option<String>,
    delete_on_revert: bool,
) -> Result<(), String> {
    let previous_id = crate::commands::settings::current(&app).active_theme_id;
    let at = Instant::now();
    let displaced = {
        let state = app.state::<crate::state::AppState>();
        let mut slot = state
            .pending_theme
            .lock()
            .map_err(|_| "The pending theme activation lock is poisoned".to_string())?;
        arm(&mut slot, previous_id, new_id.clone(), delete_on_revert, at)
    };
    // A re-arm before the previous one was confirmed or reverted abandons it
    // exactly like a revert would — clean it up the same way.
    if let Some(displaced) = abandoned_duplicate(displaced, &new_id) {
        delete_orphaned_duplicate(&app, &displaced);
    }

    spawn_expiry(&app, at + ACTIVATION_WINDOW);
    show_guard_window(&app)
}

/// The displaced activation worth cleaning up, if any. An activation whose
/// `new_id` matches the one just armed is the *same* target pressed twice
/// (a double-click), never an abandoned duplicate — cleaning it up would
/// delete the theme the caller still wants.
fn abandoned_duplicate(
    displaced: Option<PendingActivation>,
    new_id: &Option<String>,
) -> Option<PendingActivation> {
    displaced.filter(|d| d.new_id != *new_id)
}

/// Make the previewed theme permanent — the flow's only write to `settings.json`.
/// Nothing pending is a no-op success, not an error: a stale or duplicate call
/// (double-click, or arriving after a revert) must not surface as a failure.
#[tauri::command]
pub fn confirm_activation(app: AppHandle) -> Result<(), String> {
    let armed = {
        let state = app.state::<crate::state::AppState>();
        let mut slot = state
            .pending_theme
            .lock()
            .map_err(|_| "The pending theme activation lock is poisoned".to_string())?;
        take_if_live(&mut slot, Instant::now())
    };

    let Some(pending) = armed else {
        hide_guard_window(&app);
        return Ok(());
    };
    let saved = crate::commands::settings::set_active_theme_id(&app, pending.new_id.clone());
    match &saved {
        Ok(()) => crate::log::log_line(
            &app,
            "theme",
            &format!("Confirmed theme {:?}", pending.new_id),
        ),
        Err(err) => {
            crate::log::log_line(
                &app,
                "theme",
                &format!("Could not save theme {:?}; reverted: {err}", pending.new_id),
            );
            finish_revert(&app, &pending);
        }
    }

    hide_guard_window(&app);
    saved
}

/// Abandon the previewed theme, write nothing, and tell `main` to re-apply
/// `previousId`. Uses [`take_any`], not [`take_if_live`]: the frontend calls
/// this at zero, which can arrive after the backend timer has already reverted.
#[tauri::command]
pub fn revert_activation(app: AppHandle) -> Result<(), String> {
    let armed = {
        let state = app.state::<crate::state::AppState>();
        let mut slot = state
            .pending_theme
            .lock()
            .map_err(|_| "The pending theme activation lock is poisoned".to_string())?;
        take_any(&mut slot)
    };

    if let Some(pending) = armed {
        finish_revert(&app, &pending);
    }

    hide_guard_window(&app);
    Ok(())
}

/// The `theme-activation-reverted` payload: the theme the frontend re-applies.
fn reverted_payload(pending: &PendingActivation) -> serde_json::Value {
    serde_json::json!({ "previousId": pending.previous_id })
}

/// The pending activation, for the guard window's countdown poll. Read-only —
/// confirming or reverting is the caller's decision.
#[tauri::command]
pub fn get_activation_status(app: AppHandle) -> Option<ActivationStatus> {
    let state = app.state::<crate::state::AppState>();
    let armed = state.pending_theme.lock().ok()?;
    read(&armed, Instant::now())
}

// ── Theme Hot Reload ────────────────────────────────────────────────────────
//
// While Dev Mode is on, the active theme's directory is watched so a saved
// edit reaches the frontend without a manual reload. Which theme to watch is
// the caller's decision, made on every Dev Mode toggle and active-theme
// change; watching is at most one directory at a time, and a theme with
// nothing on disk is a silent no-op rather than an error to handle.

/// Watch the theme `id` for edits, replacing any theme already being watched.
#[tauri::command]
pub fn watch_active_theme(app: AppHandle, id: String) -> Result<(), String> {
    theme::watch::watch(&app, &id)
}

/// Stop watching the active theme, if one is being watched.
#[tauri::command]
pub fn stop_watching_theme(app: AppHandle) -> Result<(), String> {
    theme::watch::stop(&app)
}

/// Copy every file under `source` into `target` at the same relative path,
/// writing `manifest_json` in place of the source's root `theme.json`, so the
/// copy never carries the source's id.
fn copy_package_with_manifest(
    source: &Path,
    target: &Path,
    manifest_json: &[u8],
) -> Result<(), String> {
    let mut stack = vec![(source.to_path_buf(), PathBuf::new())];
    while let Some((dir, relative)) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Could not read {}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let at = relative.join(entry.file_name());
            let from = entry.path();
            if from.is_dir() {
                stack.push((from, at));
                continue;
            }
            let to = target.join(&at);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
            }
            // The root manifest is the caller's — the theme's identity lives in
            // it. A same-named file deeper in the package is asset content and
            // is copied verbatim, as every other file is.
            let is_root_manifest =
                relative.as_os_str().is_empty() && at == Path::new(theme::MANIFEST_FILE);
            let written = if is_root_manifest {
                crate::atomic_write::write_atomically(&to, manifest_json)
            } else {
                // Byte for byte: an image or font must never travel through a String.
                std::fs::copy(&from, &to).map(|_| ())
            };
            written.map_err(|e| format!("Could not write {}: {e}", to.display()))?;
        }
    }
    Ok(())
}

/// The source files a derived theme never inherits: the source's own identity
/// and palette, its seed provenance, its README and its screenshots.
fn is_derivation_excluded(relative: &Path) -> bool {
    if relative.starts_with("previews") {
        return true;
    }
    matches!(
        relative.to_str(),
        Some(theme::MANIFEST_FILE | theme::TOKENS_FILE | SEED_PROVENANCE_FILE | "README.md")
    )
}

/// Copy what a derived theme inherits from its source — byte for byte, so an
/// image or font never travels through a String — then write the caller's
/// manifest and palette over the source's own.
fn copy_derived_content(
    source: &Path,
    target: &Path,
    manifest_json: &[u8],
    tokens_json: &[u8],
) -> Result<(), String> {
    let mut stack = vec![(source.to_path_buf(), PathBuf::new())];
    while let Some((dir, relative)) = stack.pop() {
        let entries = std::fs::read_dir(&dir)
            .map_err(|e| format!("Could not read {}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let at = relative.join(entry.file_name());
            if is_derivation_excluded(&at) {
                continue;
            }
            let from = entry.path();
            if from.is_dir() {
                stack.push((from, at));
                continue;
            }
            let to = target.join(&at);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
            }
            std::fs::copy(&from, &to)
                .map_err(|e| format!("Could not write {}: {e}", to.display()))?;
        }
    }
    for (name, bytes) in [
        (theme::MANIFEST_FILE, manifest_json),
        (theme::TOKENS_FILE, tokens_json),
    ] {
        let path = target.join(name);
        crate::atomic_write::write_atomically(&path, bytes)
            .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    }
    Ok(())
}

/// Save a copy of an installed theme under `manifest.id`, keeping everything
/// the source ships beyond its colours — layout, CSS, settings — and replacing
/// its manifest and palette with the caller's. Create-only, exactly as
/// [`save_theme`]: an id that already has a directory is an error.
fn derive_from_installed(
    themes_root: &Path,
    source_id: &str,
    manifest: &ThemeManifest,
    tokens: &serde_json::Value,
) -> Result<String, String> {
    if !theme::is_usable_id(source_id) {
        return Err(format!(
            "`{source_id}` is not a usable theme id — it must be a single directory name"
        ));
    }
    // Also a path component, so it is checked before anything is created.
    if !theme::is_usable_id(&manifest.id) {
        return Err(format!(
            "`{}` is not a usable theme id — it must be a single directory name",
            manifest.id
        ));
    }
    theme::validate_new_theme_id(&manifest.id)?;
    let source = themes_root.join(source_id);
    if !source.is_dir() {
        return Err(format!(
            "No installed theme `{source_id}` at {}",
            source.display()
        ));
    }
    theme::validate_tokens(tokens)?;

    // Read through `get`: the source's capabilities come from a manifest a
    // user could see in the grid.
    let source_manifest = theme::get(themes_root, source_id)
        .map_err(|e| format!("Could not read the installed theme `{source_id}`: {e}"))?
        .manifest;

    let mut derived = manifest.clone();
    derived.capabilities = source_manifest.capabilities;
    if !derived.capabilities.iter().any(|c| c == "tokens") {
        derived.capabilities.push("tokens".to_string());
    }
    // The source's screenshots are not this theme's; a derived theme ships none.
    derived.preview = None;
    derived.previews = Vec::new();

    let manifest_json = serde_json::to_vec_pretty(&derived)
        .map_err(|e| format!("Could not serialise the manifest: {e}"))?;
    let tokens_json = serde_json::to_vec_pretty(tokens)
        .map_err(|e| format!("Could not serialise tokens: {e}"))?;

    std::fs::create_dir_all(themes_root)
        .map_err(|e| format!("Could not create {}: {e}", themes_root.display()))?;
    let target = themes_root.join(&manifest.id);
    // create_dir, not create_dir_all: an installed theme must fail, not merge.
    std::fs::create_dir(&target).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!(
            "A theme with id `{}` is already installed at {}",
            manifest.id,
            target.display()
        ),
        _ => format!("Could not create {}: {e}", target.display()),
    })?;

    if let Err(e) = copy_derived_content(&source, &target, &manifest_json, &tokens_json) {
        // A half-copied theme would list as one that can't load.
        let _ = std::fs::remove_dir_all(&target);
        return Err(e);
    }

    // Only a theme that loads is a theme; a copy this build cannot read must
    // not be left in the grid either.
    match theme::get(themes_root, &manifest.id) {
        Ok(_) => Ok(manifest.id.clone()),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&target);
            Err(e)
        }
    }
}

/// Save a copy of an installed theme under a new manifest, keeping its layout,
/// CSS and settings — the customiser's "save as new" for a source richer than a
/// colour palette. Create-only, exactly as [`save_theme`].
#[tauri::command]
pub fn derive_theme(
    app: AppHandle,
    source_id: String,
    manifest: ThemeManifest,
    tokens: serde_json::Value,
) -> Result<String, String> {
    let id = derive_from_installed(
        &crate::paths::themes_dir(&app),
        &source_id,
        &manifest,
        &tokens,
    )?;
    crate::log::log_line(
        &app,
        "theme",
        &format!("Derived theme `{id}` from `{source_id}`"),
    );
    Ok(id)
}

// ── Builtin Showcase Themes ─────────────────────────────────────────────────
//
// Launcher-bundled packages seeded into the themes directory from `setup`.
// They are not user input, so they skip `stage_for_preview`.

/// Must match `BUILTIN_SHOWCASE_IDS` in the frontend's ThemeGrid.
const BUILTIN_THEME_IDS: [&str; 1] = ["builtin.tactical"];

const BUILTIN_THEMES: &str = "resources/builtin-themes";

fn builtin_themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(BUILTIN_THEMES, BaseDirectory::Resource)
        .map_err(|e| format!("Could not locate the bundled builtin themes: {e}"))
}

/// Provenance recorded beside an installed builtin, naming the exact bundled
/// version it came from and a content fingerprint. The only way to tell a
/// pristine copy from one edited by the user or a theme author.
const SEED_PROVENANCE_FILE: &str = ".tetra-seed";

#[derive(serde::Serialize, serde::Deserialize)]
struct SeedProvenance {
    version: String,
    fingerprint: String,
}

/// A stable hash over every file under `dir` (relative path + bytes), the
/// provenance file and the user's tuning excluded. Sorted so file-system
/// iteration order never changes the result.
fn fingerprint_theme_dir(dir: &Path) -> Result<String, String> {
    let mut files: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), PathBuf::new())];
    while let Some((current, relative)) = stack.pop() {
        let entries = std::fs::read_dir(&current)
            .map_err(|e| format!("Could not read {}: {e}", current.display()))?;
        for entry in entries.flatten() {
            let at = relative.join(entry.file_name());
            let path = entry.path();
            if path.is_dir() {
                stack.push((path, at));
                continue;
            }
            if at == Path::new(SEED_PROVENANCE_FILE)
                || at == Path::new(crate::theme::settings_values::SETTINGS_VALUES_FILE)
            {
                continue;
            }
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
            files.push((at, bytes));
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for (path, bytes) in &files {
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        hasher.update(bytes);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn write_seed_provenance(target: &Path, version: &str) -> Result<(), String> {
    let fingerprint = fingerprint_theme_dir(target)?;
    let json = serde_json::to_vec_pretty(&SeedProvenance {
        version: version.to_string(),
        fingerprint,
    })
    .map_err(|e| format!("Could not serialise seed provenance: {e}"))?;
    let path = target.join(SEED_PROVENANCE_FILE);
    crate::atomic_write::write_atomically(&path, &json)
        .map_err(|e| format!("Could not write {}: {e}", path.display()))
}

fn read_seed_provenance(dir: &Path) -> Option<SeedProvenance> {
    let bytes = std::fs::read(dir.join(SEED_PROVENANCE_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Semver-ish comparison so `"2.10.0"` beats `"2.9.0"`, not lexical — the
/// same `semver::Version` parse-and-compare `theme::archive`'s manifest
/// version gate uses, rather than a hand-rolled comparator.
fn bundled_version_is_newer(bundled: &str, installed: &str) -> bool {
    match (
        semver::Version::parse(bundled.trim()),
        semver::Version::parse(installed.trim()),
    ) {
        (Ok(bundled), Ok(installed)) => bundled > installed,
        _ => false,
    }
}

/// Copies the bundled theme `id` into `themes_root/<id>` with its manifest
/// unchanged, and records seed provenance for it.
fn install_builtin_theme(
    source_root: &Path,
    themes_root: &Path,
    id: &str,
) -> Result<String, String> {
    if !theme::is_usable_id(id) {
        return Err(format!(
            "`{id}` is not a usable builtin theme id — it must be a single directory name"
        ));
    }
    let source = source_root.join(id);
    if !source.is_dir() {
        return Err(format!("No bundled builtin theme `{id}`."));
    }

    let manifest_json = std::fs::read(source.join(theme::MANIFEST_FILE))
        .map_err(|e| format!("Could not read the bundled builtin theme `{id}`: {e}"))?;

    std::fs::create_dir_all(themes_root)
        .map_err(|e| format!("Could not create {}: {e}", themes_root.display()))?;
    // create_dir, not create_dir_all: a concurrent install must fail, not merge.
    let target = themes_root.join(id);
    std::fs::create_dir(&target).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!(
            "A theme with id `{id}` is already installed at {}",
            target.display()
        ),
        _ => format!("Could not create {}: {e}", target.display()),
    })?;

    let install = copy_package_with_manifest(&source, &target, &manifest_json).and_then(|()| {
        let manifest: ThemeManifest = serde_json::from_slice(&manifest_json)
            .map_err(|e| format!("Could not parse the bundled manifest for `{id}`: {e}"))?;
        write_seed_provenance(&target, &manifest.version)
    });

    if let Err(e) = install {
        // A half-copied theme would list as one that can't load.
        let _ = std::fs::remove_dir_all(&target);
        return Err(e);
    }
    restore_tuning(themes_root, id, &target)?;
    Ok(id.to_string())
}

/// Where a refresh parks the user's tuning while the builtin folder is replaced.
fn tuning_backup(themes_root: &Path, id: &str) -> PathBuf {
    themes_root.join(format!(".{id}.tuning.bak"))
}

/// Puts back tuning a refresh parked, including one a failed refresh left behind.
fn restore_tuning(themes_root: &Path, id: &str, target: &Path) -> Result<(), String> {
    let backup = tuning_backup(themes_root, id);
    if !backup.is_file() {
        return Ok(());
    }
    let tuning_path = target.join(crate::theme::settings_values::SETTINGS_VALUES_FILE);
    std::fs::copy(&backup, &tuning_path).map_err(|e| {
        format!(
            "Could not restore {} (the tuning is kept at {}): {e}",
            tuning_path.display(),
            backup.display()
        )
    })?;
    let _ = std::fs::remove_file(&backup);
    Ok(())
}

/// Outcome of checking one already-installed builtin against the bundled copy.
enum RefreshOutcome {
    Replaced { from: String, to: String },
    Kept(&'static str),
}

/// An installed builtin is only ever replaced when it's provably unmodified —
/// its seed record's fingerprint matches its current files — and the bundled
/// version is strictly newer. Anything else (no record, a changed
/// fingerprint, or no version gain) is left exactly as it is.
fn refresh_builtin_theme(
    source_root: &Path,
    themes_root: &Path,
    id: &str,
) -> Result<Option<RefreshOutcome>, String> {
    let target = themes_root.join(id);
    let Some(provenance) = read_seed_provenance(&target) else {
        return Ok(Some(RefreshOutcome::Kept(
            "no seed record — treated as the user's own copy",
        )));
    };
    let fingerprint = fingerprint_theme_dir(&target)?;
    if fingerprint != provenance.fingerprint {
        return Ok(Some(RefreshOutcome::Kept(
            "its files were changed since install",
        )));
    }

    let manifest_json = std::fs::read(source_root.join(id).join(theme::MANIFEST_FILE))
        .map_err(|e| format!("Could not read the bundled builtin theme `{id}`: {e}"))?;
    let bundled: ThemeManifest = serde_json::from_slice(&manifest_json)
        .map_err(|e| format!("Could not parse the bundled manifest for `{id}`: {e}"))?;
    if !bundled_version_is_newer(&bundled.version, &provenance.version) {
        return Ok(None);
    }

    // The backup outlives a failed refresh, so the tuning is never only in memory.
    let tuning_path = target.join(crate::theme::settings_values::SETTINGS_VALUES_FILE);
    match std::fs::copy(&tuning_path, tuning_backup(themes_root, id)) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Could not back up {}: {e}", tuning_path.display())),
    }

    std::fs::remove_dir_all(&target)
        .map_err(|e| format!("Could not remove {}: {e}", target.display()))?;
    install_builtin_theme(source_root, themes_root, id)?;
    Ok(Some(RefreshOutcome::Replaced {
        from: provenance.version,
        to: bundled.version,
    }))
}

/// Never fatal: every outcome is logged and startup carries on. Runs once per
/// process, from `setup` or from whichever theme command gets there first: on
/// Windows the webview can load and list themes before `setup` runs.
pub fn seed_builtin_themes(app: &AppHandle) {
    static SEEDED: std::sync::Once = std::sync::Once::new();
    SEEDED.call_once(|| seed_builtin_themes_now(app));
}

fn seed_builtin_themes_now(app: &AppHandle) {
    let Ok(source_root) = builtin_themes_dir(app) else {
        return;
    };
    let themes_root = crate::paths::themes_dir(app);
    let results = seed_from(&source_root, &themes_root, |line| {
        crate::log::log_line(app, "theme", line)
    });
    for result in results {
        match result {
            Ok(id) => crate::log::log_line(app, "theme", &format!("Seeded builtin theme `{id}`")),
            Err(e) => crate::log::log_line(app, "theme", &format!("Could not seed: {e}")),
        }
    }
}

/// Installs every builtin id that doesn't already load. An already-installed
/// id is replaced by the bundled copy only when it's unmodified (fingerprint
/// matches its seed record) and the bundled version is newer; an edited copy,
/// or one with no seed record, is left alone. A deleted one comes back next
/// launch. `log` receives one line for every outcome besides a fresh install
/// or replace, which the caller logs itself from the returned results.
fn seed_from(
    source_root: &Path,
    themes_root: &Path,
    mut log: impl FnMut(&str),
) -> Vec<Result<String, String>> {
    let mut results = Vec::with_capacity(BUILTIN_THEME_IDS.len());
    for id in BUILTIN_THEME_IDS {
        if theme::get(themes_root, id).is_ok() {
            match refresh_builtin_theme(source_root, themes_root, id) {
                Ok(Some(RefreshOutcome::Replaced { from, to })) => {
                    log(&format!("Replaced builtin theme `{id}` {from} -> {to}"));
                    results.push(Ok(id.to_string()));
                }
                Ok(Some(RefreshOutcome::Kept(reason))) => {
                    log(&format!("Kept installed builtin theme `{id}`: {reason}"));
                }
                Ok(None) => {}
                Err(e) => results.push(Err(format!("{id}: {e}"))),
            }
            continue;
        }
        results.push(
            install_builtin_theme(source_root, themes_root, id).map_err(|e| format!("{id}: {e}")),
        );
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn armed_at(at: Instant) -> Option<PendingActivation> {
        let mut slot = None;
        arm(&mut slot, None, Some("local.ember".into()), false, at);
        slot
    }

    /// A scratch themes root holding one installed theme directory.
    fn installed(tag: &str, id: &str) -> (PathBuf, PathBuf) {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("tetra-arm-{tag}-{nanos}"));
        let dir = root.join(id);
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        (root, dir)
    }

    /// A poll after the deadline must report `0`, not an underflowed/huge duration.
    #[test]
    fn remaining_ms_counts_down_to_zero_at_the_deadline() {
        let started = Instant::now();
        let pending = armed_at(started).unwrap();

        let cases = [
            (started, ACTIVATION_WINDOW.as_millis() as u64),
            (started + Duration::from_secs(5), 10_000),
            (started + ACTIVATION_WINDOW + Duration::from_secs(1), 0),
        ];
        for (now, expected) in cases {
            assert_eq!(
                pending.remaining_ms(now),
                expected,
                "now: +{:?}",
                now.saturating_duration_since(started)
            );
        }
    }

    /// No previous theme (the built-in default) serialises as `null`, not an empty string.
    #[test]
    fn a_pending_activation_serialises_with_the_ids_it_was_armed_with() {
        let pending = armed_at(Instant::now()).unwrap();

        let json = serde_json::to_value(ActivationStatus::of(&pending, Instant::now())).unwrap();

        assert_eq!(json["previousId"], serde_json::Value::Null);
        assert_eq!(json["newId"], "local.ember");
        assert!(json["remainingMs"].as_u64().unwrap() > 0);
        assert!(json["remainingMs"].as_u64().unwrap() <= ACTIVATION_WINDOW.as_millis() as u64);
    }

    /// A poll must not consume the activation, or the guard window's own polling
    /// would lose the switch before the user could confirm.
    #[test]
    fn reading_the_status_leaves_the_activation_armed() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let first = read(&slot, started).expect("armed");
        let second = read(&slot, started + Duration::from_secs(3)).expect("still armed");

        assert_eq!(second.remaining_ms, first.remaining_ms - 3_000);

        let taken =
            take_if_live(&mut slot, started + Duration::from_secs(4)).expect("still takeable");
        assert_eq!(taken.new_id.as_deref(), Some("local.ember"));
    }

    /// A second (double-clicked) confirm must find nothing, not confirm twice.
    #[test]
    fn confirming_takes_a_live_activation_once() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let taken = take_if_live(&mut slot, started + Duration::from_secs(1)).expect("armed");

        assert_eq!(taken.new_id.as_deref(), Some("local.ember"));
        assert_eq!(taken.previous_id, None);
        assert!(slot.is_none());
        assert!(take_if_live(&mut slot, started + Duration::from_secs(2)).is_none());
    }

    /// The backend timer takes only an expired activation; a live one stays
    /// armed, and confirm refuses the expired one.
    #[test]
    fn expiry_takes_only_an_expired_activation_and_confirm_refuses_it() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        assert!(take_if_expired(&mut slot, started + Duration::from_secs(1)).is_none());
        assert!(slot.is_some(), "a live activation must stay armed");

        let expired_at = started + ACTIVATION_WINDOW + Duration::from_millis(1);
        assert!(take_if_live(&mut slot, expired_at).is_none());
        assert!(slot.is_some(), "confirm must not have consumed it");

        let taken = take_if_expired(&mut slot, expired_at).expect("expired activation is taken");
        assert_eq!(taken.new_id.as_deref(), Some("local.ember"));
        assert!(slot.is_none(), "expiry leaves nothing pending behind");
    }

    /// Trying a second theme before answering replaces the pending one and
    /// restarts the clock, handing back what it displaced so the caller can
    /// clean up an abandoned duplicate.
    #[test]
    fn re_arming_replaces_the_pending_activation_and_returns_what_it_displaced() {
        let started = Instant::now();
        let mut slot = None;
        let first = arm(&mut slot, None, Some("local.first".into()), true, started);
        assert!(first.is_none(), "nothing was pending yet");

        let later = started + Duration::from_secs(10);
        let armed = arm(
            &mut slot,
            Some("local.ember".into()),
            Some("dev.pack".into()),
            false,
            later,
        );

        let displaced = armed.expect("the first arm was displaced");
        assert_eq!(displaced.new_id.as_deref(), Some("local.first"));
        assert!(
            displaced.delete_on_revert,
            "carried the flag it was armed with"
        );

        let pending = slot.as_ref().expect("still armed");
        assert_eq!(pending.new_id.as_deref(), Some("dev.pack"));
        assert_eq!(pending.previous_id.as_deref(), Some("local.ember"));
        assert_eq!(pending.deadline, later + ACTIVATION_WINDOW);
        assert_eq!(pending.remaining_ms(later), 15_000);
    }

    /// A stray confirm or revert after the flow settled must be a quiet no-op.
    #[test]
    fn nothing_armed_reads_and_takes_as_nothing() {
        let mut slot: Option<PendingActivation> = None;
        let now = Instant::now();

        assert!(read(&slot, now).is_none());
        assert!(take_if_live(&mut slot, now).is_none());
        assert!(take_any(&mut slot).is_none());
    }

    /// Re-arming the *same* id is one flow pressed twice, not an abandoned
    /// duplicate — cleaning it up would delete the theme the caller still wants.
    #[test]
    fn re_arming_the_same_id_is_not_an_abandoned_duplicate() {
        let id = Some("local.ember".to_string());
        let mut slot = None;
        arm(
            &mut slot,
            Some("local.ember".into()),
            id.clone(),
            true,
            Instant::now(),
        );

        let displaced = arm(
            &mut slot,
            Some("local.ember".into()),
            id.clone(),
            false,
            Instant::now(),
        );

        assert!(abandoned_duplicate(displaced, &id).is_none());
    }

    /// The event carries the id `main` re-applies, and nothing else.
    #[test]
    fn the_reverted_payload_names_the_theme_to_re_apply() {
        let mut slot = None;
        arm(
            &mut slot,
            Some("local.ember".into()),
            Some("dev.pack".into()),
            false,
            Instant::now(),
        );

        assert_eq!(
            reverted_payload(slot.as_ref().unwrap()),
            serde_json::json!({ "previousId": "local.ember" })
        );
    }

    fn write(dir: &Path, relative: &str, content: &str) {
        let path = dir.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn validate_theme_reports_no_error_issues_for_a_theme_that_is_all_valid() {
        let (root, dir) = installed("validate-ok", "local.ok");
        write(
            &dir,
            "layout/shell.json",
            r#"{"schemaVersion":2,"root":{"type":"box"}}"#,
        );

        let issues = validate_theme_at(&root, "local.ok").unwrap();

        assert!(
            issues.iter().all(|i| i.severity != Severity::Error),
            "{issues:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_theme_reports_lay01_for_a_malformed_layout_file() {
        let (root, dir) = installed("validate-bad-layout", "local.bad-layout");
        write(&dir, "layout/shell.json", "{ not json");

        let issues = validate_theme_at(&root, "local.bad-layout").unwrap();

        assert!(
            issues
                .iter()
                .any(|i| i.rule_id == "LAY-01" && i.file == "layout/shell.json"),
            "{issues:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_theme_refuses_an_at_import_in_styles_css() {
        let (root, dir) = installed("validate-css", "local.css");
        write(&dir, "styles.css", "@import \"other.css\";");

        let issues = validate_theme_styles(&dir).unwrap();

        assert!(issues.iter().any(|i| i.file == "styles.css"), "{issues:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_theme_reports_set01_for_a_malformed_settings_schema() {
        let (root, dir) = installed("validate-bad-settings", "local.bad-settings");
        write(&dir, theme::SETTINGS_SCHEMA_FILE, "{ not json");

        let (_, issues) = validate_theme_settings(&dir).unwrap();

        assert!(
            issues
                .iter()
                .any(|i| i.rule_id == "SET-01" && i.file == theme::SETTINGS_SCHEMA_FILE),
            "{issues:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn validate_theme_refuses_a_missing_theme_directory() {
        let root = std::env::temp_dir().join("tetra-validate-missing-does-not-exist");
        let _ = std::fs::remove_dir_all(&root);

        assert!(validate_theme_at(&root, "local.missing").is_err());
    }
}

/// Deriving a theme from an installed one: the source's layout, CSS and
/// settings must survive byte for byte, and the result must be a create-only
/// neighbour of the source — never a half-written directory.
#[cfg(test)]
mod derive_from_installed {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A scratch directory unique to one test (no `tempfile` dependency), the
    /// way the rest of `theme` does it — never a real themes root.
    fn scratch(tag: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let seq = N.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-derive-{tag}-{nanos}-{seq}"));
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        dir
    }

    /// Every file under `dir`, as `(name relative to `dir`, bytes)`.
    fn files_under(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let mut files = Vec::new();
        let mut stack = vec![(dir.to_path_buf(), String::new())];
        while let Some((current, prefix)) = stack.pop() {
            for entry in std::fs::read_dir(&current).unwrap().flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let relative = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                if entry.path().is_dir() {
                    stack.push((entry.path(), relative));
                } else {
                    files.push((relative, std::fs::read(entry.path()).unwrap()));
                }
            }
        }
        files.sort();
        files
    }

    fn copy_tree(source: &Path, target: &Path) {
        std::fs::create_dir_all(target).unwrap();
        for entry in std::fs::read_dir(source).unwrap().flatten() {
            let to = target.join(entry.file_name());
            if entry.path().is_dir() {
                copy_tree(&entry.path(), &to);
            } else {
                std::fs::copy(entry.path(), to).unwrap();
            }
        }
    }

    /// A scratch themes root holding one installed source copied from the shipped
    /// Tactical package: real layout, CSS and settings files, plus the three files a
    /// derivation must leave behind — a README, a seed marker and screenshots.
    fn source_theme(tag: &str, capabilities: &[&str]) -> (PathBuf, PathBuf) {
        let root = scratch(tag);
        let source = root.join("local.source");
        let shipped = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/builtin-themes");
        copy_tree(&shipped.join("builtin.tactical"), &source);
        std::fs::write(source.join("README.md"), "# Source").unwrap();

        let manifest: ThemeManifest = serde_json::from_value(serde_json::json!({
            "schemaVersion": 2,
            "id": "local.source",
            "name": "Source",
            "author": "Source Author",
            "capabilities": capabilities,
            // The source's screenshots are not the copy's.
            "previews": [{ "file": "previews/dark.png", "caption": "Dark" }],
        }))
        .expect("a valid source manifest");
        std::fs::write(
            source.join(theme::MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        std::fs::write(source.join(SEED_PROVENANCE_FILE), "{}").unwrap();
        std::fs::create_dir_all(source.join("previews")).unwrap();
        std::fs::write(source.join("previews/dark.png"), b"\x89PNG\r\n").unwrap();
        // The user's tuned values are this theme's own settings, so they travel.
        std::fs::write(
            source.join(crate::theme::settings_values::SETTINGS_VALUES_FILE),
            br#"{"windowControls":false}"#,
        )
        .unwrap();
        (root, source)
    }

    fn derived_manifest() -> ThemeManifest {
        ThemeManifest {
            schema_version: 2,
            id: "local.derived".to_string(),
            name: "Derived".to_string(),
            author: "local".to_string(),
            capabilities: vec!["tokens".to_string()],
            ..ThemeManifest::default()
        }
    }

    #[test]
    fn copies_the_sources_content_and_writes_the_callers_manifest_and_palette() {
        let (root, source) = source_theme("copies", &["layout", "css", "settings"]);
        let tokens = serde_json::json!({
            "schemaVersion": 2,
            "bloom": 0.5,
            "colors": { "dark": { "bg": "#010101" }, "light": {} },
        });

        let id = derive_from_installed(&root, "local.source", &derived_manifest(), &tokens)
            .expect("derive");

        assert_eq!(id, "local.derived");
        let derived = theme::get(&root, "local.derived").expect("the derived theme loads");
        assert_eq!(
            derived.tokens, tokens,
            "the caller's palette replaces the source's"
        );
        assert_eq!(derived.manifest.name, "Derived");
        assert_eq!(derived.manifest.author, "local");
        assert_eq!(
            derived.manifest.capabilities,
            ["layout", "css", "settings", "tokens"],
            "the source's capabilities, `tokens` appended once"
        );
        assert!(
            derived.manifest.previews.is_empty(),
            "a derived theme ships no screenshots of its own"
        );
        assert_eq!(derived.manifest.preview, None);

        let derived_dir = root.join("local.derived");
        let source_files = files_under(&source);
        for (name, bytes) in &source_files {
            // The source's identity and palette are replaced, not skipped.
            if matches!(name.as_str(), "theme.json" | "tokens.json") {
                assert_ne!(
                    &std::fs::read(derived_dir.join(name)).unwrap(),
                    bytes,
                    "`{name}` should have been rewritten, not copied"
                );
                continue;
            }
            let excluded = name.starts_with("previews/")
                || matches!(name.as_str(), "README.md" | ".tetra-seed");
            if excluded {
                assert!(
                    !derived_dir.join(name).exists(),
                    "`{name}` must not be copied"
                );
                continue;
            }
            assert_eq!(
                &std::fs::read(derived_dir.join(name)).unwrap(),
                bytes,
                "`{name}` should have been copied byte for byte"
            );
        }
        // ...and nothing else arrived: the copy is the source's files, minus
        // the five left behind (manifest, palette, README, seed, screenshot),
        // plus the two written fresh.
        assert_eq!(
            files_under(&derived_dir).len(),
            source_files.len() - 5 + 2,
            "unexpected files in the derived theme"
        );
        assert!(!derived_dir.join("previews").exists());

        // The source is untouched by the derivation.
        let after = theme::get(&root, "local.source").unwrap();
        assert_eq!(after.manifest.id, "local.source");
        assert_eq!(after.manifest.name, "Source");
        assert_eq!(
            files_under(&source).len(),
            source_files.len(),
            "the source's own files, unchanged"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A source that already declares `tokens` keeps its own order, with no
    /// duplicate appended.
    #[test]
    fn capabilities_are_the_sources_with_tokens_added_once() {
        let (root, _) = source_theme("capabilities", &["tokens", "layout"]);
        let tokens =
            serde_json::json!({ "schemaVersion": 2, "colors": { "dark": {}, "light": {} } });

        derive_from_installed(&root, "local.source", &derived_manifest(), &tokens).expect("derive");

        assert_eq!(
            theme::get(&root, "local.derived")
                .unwrap()
                .manifest
                .capabilities,
            ["tokens", "layout"]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Create-only, exactly as `save`: an installed id is an error, and the
    /// theme already there survives unchanged.
    #[test]
    fn deriving_onto_an_installed_id_is_refused_and_changes_nothing() {
        let (root, _) = source_theme("taken", &["layout"]);
        theme::save(
            &root,
            &ThemeManifest {
                id: "local.derived".to_string(),
                name: "Already Here".to_string(),
                ..ThemeManifest::default()
            },
            &serde_json::json!({ "schemaVersion": 2, "colors": { "dark": {}, "light": {} } }),
        )
        .expect("seed the installed theme");
        let before = files_under(&root.join("local.derived"));

        let error = derive_from_installed(
            &root,
            "local.source",
            &derived_manifest(),
            &serde_json::json!({ "schemaVersion": 2, "colors": { "dark": {}, "light": {} } }),
        )
        .expect_err("an installed id must be refused");

        assert!(error.contains("already installed"), "{error}");
        assert_eq!(
            theme::get(&root, "local.derived").unwrap().manifest.name,
            "Already Here",
            "the installed theme survives the refusal"
        );
        assert_eq!(files_under(&root.join("local.derived")), before);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An id that could name a path is refused, as is a source this root does
    /// not hold — all before anything is created.
    #[test]
    fn an_unusable_or_missing_id_creates_nothing() {
        let (root, _) = source_theme("bad-ids", &["layout"]);
        let tokens =
            serde_json::json!({ "schemaVersion": 2, "colors": { "dark": {}, "light": {} } });

        let error = derive_from_installed(&root, "../escape", &derived_manifest(), &tokens)
            .expect_err("a path is not a source id");
        assert!(error.contains("not a usable theme id"), "{error}");

        let mut escaping = derived_manifest();
        escaping.id = "../escape".to_string();
        let error = derive_from_installed(&root, "local.source", &escaping, &tokens)
            .expect_err("a path is not a derived id");
        assert!(error.contains("not a usable theme id"), "{error}");

        let mut reserved = derived_manifest();
        reserved.id = "builtin.copy".to_string();
        let error = derive_from_installed(&root, "local.source", &reserved, &tokens)
            .expect_err("a reserved id is not a derived id");
        assert!(error.contains("reserved prefix 'builtin.'"), "{error}");

        let error = derive_from_installed(&root, "local.missing", &derived_manifest(), &tokens)
            .expect_err("this root holds no such theme");
        assert!(error.contains("local.missing"), "{error}");

        assert!(!root.join("local.derived").exists());
        assert!(!root.join("..").join("escape").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A palette the backend would never load is refused before the directory
    /// exists, so nothing half-made is left for the grid to show.
    #[test]
    fn an_invalid_palette_is_refused_with_nothing_created() {
        let (root, _) = source_theme("bad-tokens", &["layout"]);

        for tokens in [
            serde_json::json!({ "schemaVersion": 1 }),
            serde_json::json!({ "colors": { "dark": {}, "light": {} } }),
        ] {
            let error = derive_from_installed(&root, "local.source", &derived_manifest(), &tokens)
                .expect_err("an invalid palette must be refused");
            assert!(error.contains("tokens.json"), "{error}");
        }

        assert!(!root.join("local.derived").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}

/// The bundled builtin themes are real, shipped content: these hold them to
/// the codebase's own validators rather than to a description of them, so a
/// package that would not load for a user fails here instead.
#[cfg(test)]
mod builtin_themes {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A scratch directory unique to one test (no `tempfile` dependency), the
    /// way the rest of `theme` does it — never a real themes root.
    fn scratch(tag: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let seq = N.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-builtin-{tag}-{nanos}-{seq}"));
        std::fs::create_dir_all(&dir).expect("could not create scratch dir");
        dir
    }

    /// The packages' own directory in `resources/`, unchanged from the disk —
    /// directory name is id.
    fn shipped() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/builtin-themes")
    }

    fn files_under(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let mut files = Vec::new();
        let mut stack = vec![(dir.to_path_buf(), String::new())];
        while let Some((current, prefix)) = stack.pop() {
            for entry in std::fs::read_dir(&current).unwrap().flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let relative = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                if entry.path().is_dir() {
                    stack.push((entry.path(), relative));
                } else {
                    files.push((relative, std::fs::read(entry.path()).unwrap()));
                }
            }
        }
        files.sort();
        files
    }

    #[test]
    fn every_bundled_builtin_theme_is_listed_with_its_declared_capabilities() {
        let scan = theme::scan(&shipped());

        assert!(scan.skipped.is_empty(), "{:?}", scan.skipped);
        let ids: Vec<&str> = scan.themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, BUILTIN_THEME_IDS, "the shipped set, sorted by id");
        let tactical = scan
            .themes
            .iter()
            .find(|t| t.id == "builtin.tactical")
            .expect("builtin.tactical is present");
        assert_eq!(
            tactical.capabilities,
            ["tokens", "css", "layout", "settings"]
        );
    }

    /// Copy Tactical, export the copy, import it: the copy's layouts load without
    /// falling back, and its CSS and settings pass the checks a shared theme goes
    /// through.
    #[test]
    fn a_copy_of_tactical_exports_and_stages_for_import() {
        let root = scratch("copy-roundtrip");
        install_builtin_theme(&shipped(), &root, "builtin.tactical").expect("install");
        let source = theme::get(&root, "builtin.tactical").expect("installed");
        let manifest = ThemeManifest {
            id: "local.tactical-copy".to_string(),
            name: "Tactical Copy".to_string(),
            author: "local".to_string(),
            ..source.manifest
        };
        derive_from_installed(&root, "builtin.tactical", &manifest, &source.tokens)
            .expect("derive");
        let copy = theme::get(&root, "local.tactical-copy").expect("the copy loads");
        assert!(copy.fallbacks.is_empty(), "{:?}", copy.fallbacks);

        let zip = root.join("copy.zip");
        theme::archive::export(
            &root,
            "local.tactical-copy",
            &theme::archive::ManifestOverrides::default(),
            &root,
            &zip,
        )
        .expect("export");
        let staged = theme::archive::stage_for_preview(&root, &zip, &[]).expect("stage");

        assert_eq!(staged.manifest.id, "local.tactical-copy");
        assert_eq!(
            staged.manifest.capabilities,
            ["tokens", "css", "layout", "settings"]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Each builtin theme's own files, through the validators the rest of the
    /// codebase would run them through.
    #[test]
    fn every_bundled_builtin_theme_validates_as_an_installed_theme() {
        for id in BUILTIN_THEME_IDS {
            let file = theme::get(&shipped(), id).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert_eq!(file.manifest.id, id, "{id}: directory name is its id");
            assert_eq!(file.manifest.schema_version, 2, "{id}: is a v2 package");
            assert_eq!(
                file.manifest.theme_api, "2.0",
                "{id}: speaks this build's theme API"
            );

            // A palette must be complete: every token the frontend reads, in
            // both schemes, as a hex string — an absent one silently falls
            // back to neutral, which would make the theme barely a theme.
            for scheme in ["dark", "light"] {
                for token in [
                    "bg", "surface", "surface2", "border", "text", "muted", "muted2", "accent",
                    "accent2", "success", "warn", "danger",
                ] {
                    let value = &file.tokens["colors"][scheme][token];
                    let hex = value.as_str().unwrap_or_else(|| {
                        panic!("{id}: {scheme}.{token} is not a string ({value})")
                    });
                    assert!(
                        hex.len() == 7
                            && hex.starts_with('#')
                            && hex[1..].chars().all(|c| c.is_ascii_hexdigit()),
                        "{id}: {scheme}.{token} `{hex}` is not a #rrggbb colour"
                    );
                }
            }

            let issues = validate_theme_at(&shipped(), id).unwrap_or_else(|e| panic!("{id}: {e}"));
            for issue in &issues {
                println!(
                    "VALIDATION ISSUE: {id} {:?} {} {} {}: {}",
                    issue.severity, issue.rule_id, issue.file, issue.pointer, issue.message
                );
            }
            assert!(issues.is_empty(), "{id} has validation issues: {issues:#?}");
        }
    }

    /// A builtin showcase theme must actually compose something: it ships layout files.
    #[test]
    fn each_builtin_theme_ships_a_layout_directory() {
        for id in BUILTIN_THEME_IDS {
            let layout_dir = shipped().join(id).join("layout");
            assert!(layout_dir.is_dir(), "{id}: ships a layout directory");
            let count = files_under(&layout_dir)
                .into_iter()
                .filter(|(name, _)| name.ends_with(".json"))
                .count();
            assert!(count > 0, "{id}: its layout directory is not empty");
        }
    }

    /// The permanent built-ins a user counts on: seeding an empty root
    /// installs the set, and each loads as itself, complete palette included.
    #[test]
    fn seeding_an_empty_root_installs_every_builtin_theme() {
        let source_root = shipped();
        let themes_root = scratch("empty");

        let results = seed_from(&source_root, &themes_root, |_| {});

        assert_eq!(
            results
                .iter()
                .map(|r| r.as_ref().map(String::as_str))
                .collect::<Vec<_>>(),
            BUILTIN_THEME_IDS.map(Ok),
            "every id seeded, in order"
        );
        for id in BUILTIN_THEME_IDS {
            let file = theme::get(&themes_root, id).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert_eq!(file.manifest.id, id);
            for scheme in ["dark", "light"] {
                for token in [
                    "bg", "surface", "surface2", "border", "text", "muted", "muted2", "accent",
                    "accent2", "success", "warn", "danger",
                ] {
                    assert!(
                        file.tokens["colors"][scheme][token]
                            .as_str()
                            .is_some_and(|h| h.len() == 7),
                        "{id}: {scheme}.{token} is missing from the seeded palette"
                    );
                }
            }
        }
        // The copy is a full one: every file in the package travels byte for byte.
        for (name, bytes) in files_under(&source_root.join("builtin.tactical")) {
            assert_eq!(
                std::fs::read(themes_root.join("builtin.tactical").join(&name)).unwrap(),
                bytes,
                "`{name}` should have been copied unchanged"
            );
        }
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// The user-editability guarantee behind seeding: an already-installed
    /// builtin whose files were changed after install is never overwritten —
    /// not even a hand-edited manifest — and its files are left exactly as
    /// the user's copy has them.
    #[test]
    fn seeding_twice_leaves_a_modified_installed_builtin_theme_untouched() {
        let source_root = shipped();
        let themes_root = scratch("twice");

        let first = seed_from(&source_root, &themes_root, |_| {});
        assert!(first.iter().all(Result::is_ok), "{first:?}");

        // Simulate the user's own tweak: a renamed Tactical.
        let manifest_path = themes_root
            .join("builtin.tactical")
            .join(theme::MANIFEST_FILE);
        let mut manifest: ThemeManifest =
            serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
        manifest.name = "My Tactical".to_string();
        std::fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        let before = files_under(&themes_root.join("builtin.tactical"));

        let mut logs = Vec::new();
        let second = seed_from(&source_root, &themes_root, |line| {
            logs.push(line.to_string())
        });

        assert!(
            second.is_empty(),
            "a modified installed builtin is skipped, not re-seeded: {second:?}"
        );
        assert!(
            logs.iter().any(|l| l.contains("changed since install")),
            "{logs:?}"
        );
        let reloaded = theme::get(&themes_root, "builtin.tactical").unwrap();
        assert_eq!(reloaded.manifest.name, "My Tactical", "the edit survives");
        assert_eq!(
            files_under(&themes_root.join("builtin.tactical")),
            before,
            "every file is exactly as the user's copy left it"
        );
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// A pristine copy already at the bundled version is left untouched.
    #[test]
    fn seeding_twice_with_no_changes_and_no_version_gain_does_nothing() {
        let source_root = shipped();
        let themes_root = scratch("pristine-current");

        let first = seed_from(&source_root, &themes_root, |_| {});
        assert!(first.iter().all(Result::is_ok), "{first:?}");
        let before = files_under(&themes_root.join("builtin.tactical"));

        let mut logs = Vec::new();
        let second = seed_from(&source_root, &themes_root, |line| {
            logs.push(line.to_string())
        });

        assert!(second.is_empty(), "nothing to do: {second:?}");
        assert!(logs.is_empty(), "no version gain, nothing to log: {logs:?}");
        assert_eq!(
            files_under(&themes_root.join("builtin.tactical")),
            before,
            "the pristine copy is untouched"
        );
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// No `.tetra-seed` at all (e.g. an install from before this file
    /// existed) is treated as the user's own copy and left alone.
    #[test]
    fn an_installed_builtin_with_no_provenance_file_is_kept() {
        let source_root = shipped();
        let themes_root = scratch("no-provenance");

        let first = seed_from(&source_root, &themes_root, |_| {});
        assert!(first.iter().all(Result::is_ok), "{first:?}");
        std::fs::remove_file(
            themes_root
                .join("builtin.tactical")
                .join(SEED_PROVENANCE_FILE),
        )
        .unwrap();
        let before = files_under(&themes_root.join("builtin.tactical"));

        let mut logs = Vec::new();
        let second = seed_from(&source_root, &themes_root, |line| {
            logs.push(line.to_string())
        });

        assert!(second.is_empty(), "{second:?}");
        assert!(
            logs.iter().any(|l| l.contains("no seed record")),
            "{logs:?}"
        );
        assert_eq!(
            files_under(&themes_root.join("builtin.tactical")),
            before,
            "left exactly as it was"
        );
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// A pristine installed copy with an older recorded version is replaced
    /// by the bundled copy.
    #[test]
    fn a_tuning_backup_left_by_a_failed_refresh_is_restored_on_the_next_install() {
        let source_root = shipped();
        let themes_root = scratch("leftover-tuning");
        std::fs::create_dir_all(&themes_root).unwrap();
        let tuning = br#"{"space.gap": 4}"#.to_vec();
        let backup = themes_root.join(".builtin.tactical.tuning.bak");
        std::fs::write(&backup, &tuning).unwrap();

        let seeded = seed_from(&source_root, &themes_root, |_| {});

        assert!(seeded.iter().all(Result::is_ok), "{seeded:?}");
        let sidecar = themes_root
            .join("builtin.tactical")
            .join(crate::theme::settings_values::SETTINGS_VALUES_FILE);
        assert_eq!(std::fs::read(&sidecar).unwrap(), tuning);
        assert!(!backup.exists());
    }

    #[test]
    fn a_pristine_installed_builtin_with_an_older_recorded_version_is_replaced() {
        let source_root = shipped();
        let themes_root = scratch("older-version");

        let first = seed_from(&source_root, &themes_root, |_| {});
        assert!(first.iter().all(Result::is_ok), "{first:?}");
        let bundled_version = theme::get(&source_root, "builtin.tactical")
            .unwrap()
            .manifest
            .version;

        // Roll the recorded version back without touching any theme content,
        // so the fingerprint still matches — a pristine copy of an older release.
        let provenance_path = themes_root
            .join("builtin.tactical")
            .join(SEED_PROVENANCE_FILE);
        let mut provenance: SeedProvenance =
            serde_json::from_slice(&std::fs::read(&provenance_path).unwrap()).unwrap();
        provenance.version = "0.1.0".to_string();
        std::fs::write(
            &provenance_path,
            serde_json::to_vec_pretty(&provenance).unwrap(),
        )
        .unwrap();

        // Tuning the user made in the installed copy: not an edit, and kept.
        let tuning = br#"{"space.gap": 4}"#.to_vec();
        let sidecar = themes_root
            .join("builtin.tactical")
            .join(crate::theme::settings_values::SETTINGS_VALUES_FILE);
        std::fs::write(&sidecar, &tuning).unwrap();

        let mut logs = Vec::new();
        let second = seed_from(&source_root, &themes_root, |line| {
            logs.push(line.to_string())
        });

        assert_eq!(
            second
                .iter()
                .map(|r| r.as_ref().map(String::as_str))
                .collect::<Vec<_>>(),
            vec![Ok("builtin.tactical")],
            "the stale copy is replaced: {second:?}"
        );
        assert_eq!(std::fs::read(&sidecar).unwrap(), tuning);
        assert!(
            logs.iter()
                .any(|l| l.contains("0.1.0") && l.contains(&bundled_version)),
            "{logs:?}"
        );
        for (name, bytes) in files_under(&source_root.join("builtin.tactical")) {
            assert_eq!(
                std::fs::read(themes_root.join("builtin.tactical").join(&name)).unwrap(),
                bytes,
                "`{name}` should match the freshly installed bundled copy"
            );
        }
        let reloaded: SeedProvenance = serde_json::from_slice(
            &std::fs::read(
                themes_root
                    .join("builtin.tactical")
                    .join(SEED_PROVENANCE_FILE),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(reloaded.version, bundled_version);
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// A deleted builtin is filled back in on the next seed.
    #[test]
    fn seeding_after_a_delete_restores_the_deleted_builtin() {
        let source_root = shipped();
        let themes_root = scratch("gap");

        let results = seed_from(&source_root, &themes_root, |_| {});
        assert!(results.iter().all(Result::is_ok), "{results:?}");
        std::fs::remove_dir_all(themes_root.join("builtin.tactical")).unwrap();
        assert!(theme::get(&themes_root, "builtin.tactical").is_err());

        let refilled = seed_from(&source_root, &themes_root, |_| {});

        assert_eq!(
            refilled
                .iter()
                .map(|r| r.as_ref().map(String::as_str))
                .collect::<Vec<_>>(),
            vec![Ok("builtin.tactical")],
            "the missing id is reseeded"
        );
        for id in BUILTIN_THEME_IDS {
            theme::get(&themes_root, id).unwrap_or_else(|e| panic!("{id}: {e}"));
        }
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    #[test]
    fn a_higher_minor_or_patch_beats_a_higher_first_digit_of_a_later_segment() {
        assert!(bundled_version_is_newer("2.10.0", "2.9.0"));
        assert!(!bundled_version_is_newer("2.9.0", "2.10.0"));
    }

    /// A missing source directory must surface as an `Err`, never a panic —
    /// `seed_builtin_themes` logs whatever this hands back.
    #[test]
    fn a_missing_builtin_package_is_an_error_not_a_panic() {
        let themes_root = scratch("no-source");

        let error = install_builtin_theme(&shipped(), &themes_root, "builtin.no-such")
            .expect_err("a package this build does not ship must be refused");

        assert!(error.contains("builtin.no-such"), "{error}");
        assert!(!themes_root.join("builtin.no-such").exists());
        let _ = std::fs::remove_dir_all(&themes_root);
    }
}
