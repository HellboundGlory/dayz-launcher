//! Theme commands: list/read/install/delete file-backed themes, plus the
//! legacy `localStorage` import and scaffolding a new theme from a bundled
//! starter template. Storage rules live in [`crate::theme`]; these wrappers
//! resolve the themes directory and log what got skipped.

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

    let mut issues = Vec::new();
    issues.extend(validate_theme_layouts(&dir)?);
    issues.extend(validate_theme_settings(&dir)?);
    issues.extend(validate_theme_styles(&dir)?);
    Ok(issues)
}

/// Dev Mode's view of the same parse-tolerant read the runtime fallback uses:
/// issues for files that failed to parse, then the cross-file pass
/// ([`validator::validate_theme_layouts`]) over the files that parsed.
fn validate_theme_layouts(dir: &Path) -> Result<Vec<ValidationIssue>, String> {
    let (parsed, mut issues) = theme::read_layout_files(dir)?;
    issues.extend(validator::validate_theme_layouts(&parsed));
    Ok(issues)
}

/// `settings.schema.json`, when the theme ships one. A parse failure is
/// reported as a SET-01 issue rather than failing the whole command, matching
/// how a malformed layout file is handled.
fn validate_theme_settings(dir: &Path) -> Result<Vec<ValidationIssue>, String> {
    let path = dir.join(theme::SETTINGS_SCHEMA_FILE);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    match serde_json::from_str(&content) {
        Ok(value) => Ok(validator::settings::validate_settings_schema(&value)),
        Err(error) => Ok(vec![ValidationIssue {
            rule_id: "SET-01".into(),
            severity: Severity::Error,
            file: theme::SETTINGS_SCHEMA_FILE.into(),
            pointer: String::new(),
            message: format!("Invalid settings.schema.json: {error}"),
            hint: None,
        }]),
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
        None,
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

/// Delete an installed theme. Refuses the active theme (switch away first) and
/// any id with no directory — built-in presets are not deletable this way.
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

// ── Theme Activation Safety Window ──────────────────────────────────────────
//
// A theme switch is applied live in the frontend and would otherwise be
// permanent even if the new palette makes the app unusable. `arm_activation`
// shows a theme-independent guard window and remembers the outgoing theme in
// memory, writing nothing; only `confirm_activation` touches `settings.json`.
// `revert_activation` (explicit or automatic on timeout) throws the switch
// away and tells `main` to restore the old theme.

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
/// "counting down" from "expired". Read-only: the frontend decides the outcome.
fn read(pending: &Option<PendingActivation>, now: Instant) -> Option<ActivationStatus> {
    pending.as_ref().map(|p| ActivationStatus::of(p, now))
}

/// For [`confirm_activation`] only: refuses an expired activation, which would
/// otherwise race the automatic revert the frontend fires on `remainingMs: 0`.
fn take_if_live(
    subject: &mut Option<PendingActivation>,
    now: Instant,
) -> Option<PendingActivation> {
    match subject.as_ref() {
        Some(pending) if is_live(pending, now) => subject.take(),
        _ => None,
    }
}

/// For [`revert_activation`], which must succeed on an expired activation too
/// — that's exactly what the automatic revert on timeout calls this with.
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
    let displaced = {
        let state = app.state::<crate::state::AppState>();
        let mut slot = state
            .pending_theme
            .lock()
            .map_err(|_| "The pending theme activation lock is poisoned".to_string())?;
        arm(
            &mut slot,
            previous_id,
            new_id.clone(),
            delete_on_revert,
            Instant::now(),
        )
    };
    // A re-arm before the previous one was confirmed or reverted abandons it
    // exactly like a revert would — clean it up the same way.
    if let Some(displaced) = abandoned_duplicate(displaced, &new_id) {
        delete_orphaned_duplicate(&app, &displaced);
    }

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

    if let Some(pending) = armed {
        let message = format!("Confirmed theme {:?}", pending.new_id);
        crate::commands::settings::set_active_theme_id(&app, pending.new_id)?;
        crate::log::log_line(&app, "theme", &message);
    }

    hide_guard_window(&app);
    Ok(())
}

/// Abandon the previewed theme, write nothing, and tell `main` to re-apply
/// `previousId`. Uses [`take_any`], not [`take_if_live`]: this is also what
/// the automatic revert calls on timeout, so it must work on an expired activation.
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
        let _ = app.emit("theme-activation-reverted", reverted_payload(&pending));
        crate::log::log_line(
            &app,
            "theme",
            &format!("Reverted theme activation to {:?}", pending.previous_id),
        );
        delete_orphaned_duplicate(&app, &pending);
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

// ── Starter Templates ───────────────────────────────────────────────────────
//
// Three theme packages the launcher itself ships, under `bundle.resources`, as
// worked examples of each tier — the content a "New theme" choice scaffolds
// from. Scaffolding is not an import: the bytes are launcher-bundled rather
// than user-supplied, so it skips `stage_for_preview`'s validation pipeline
// (untrusted input) and applies only the id rules `theme::save` applies.

/// The templates' directory relative to the app's resource root — the path
/// `bundle.resources` copies them to, and the one this resolves at runtime.
const STARTER_TEMPLATES: &str = "resources/starter-themes";

/// The bundled templates' directory: `src-tauri/` for a dev build, the resource
/// directory beside the executable for an installed one — both through Tauri's
/// own resource resolution, so the two cases stay one code path.
fn starter_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve(STARTER_TEMPLATES, BaseDirectory::Resource)
        .map_err(|e| format!("Could not locate the bundled starter themes: {e}"))
}

/// One template's manifest, read through [`theme::get`] so a bundled template is
/// held to exactly what an installed theme is: its directory name is its id,
/// its `tokens.json` validates, and its `layout.json` (if any) is a layout.
/// `get` never consults the tier gate — that lives on the import path — so an
/// Expert package in here loads the same way an Advanced one does.
fn read_template_manifest(starter_root: &Path, template_id: &str) -> Result<ThemeManifest, String> {
    let file = theme::get(starter_root, template_id)
        .map_err(|e| format!("Could not read the bundled starter template `{template_id}`: {e}"))?;
    Ok(file.manifest)
}

/// Copy the bundled template `template_id` into `themes_root/<new_id>`, with the
/// copied manifest's `id`/`name` rewritten to the caller's. Create-only: an
/// existing theme directory is an error, never an update. Returns the id written.
fn scaffold_from_template(
    starter_root: &Path,
    themes_root: &Path,
    template_id: &str,
    new_id: &str,
    name: &str,
) -> Result<String, String> {
    if !theme::is_usable_id(template_id) {
        return Err(format!(
            "`{template_id}` is not a usable starter template id — it must be a single directory name"
        ));
    }
    let source = starter_root.join(template_id);
    if !source.is_dir() {
        return Err(format!("No bundled starter template `{template_id}`."));
    }
    // The id becomes a path component, so it is checked before anything is
    // created — `save`'s own rule, and what keeps `create_dir` below inside the root.
    if !theme::is_usable_id(new_id) {
        return Err(format!(
            "`{new_id}` is not a usable theme id — it must be a single directory name"
        ));
    }

    let mut manifest = read_template_manifest(starter_root, template_id)?;
    manifest.id = new_id.to_string();
    manifest.name = name.to_string();
    // Read for its id/name (and re-written), but not otherwise copied: the
    // template's own manifest must never appear under the new theme's id.
    let manifest_json = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Could not serialise the manifest: {e}"))?;

    std::fs::create_dir_all(themes_root)
        .map_err(|e| format!("Could not create {}: {e}", themes_root.display()))?;
    let target = themes_root.join(new_id);
    // create_dir, not create_dir_all: an installed theme must fail, not merge.
    std::fs::create_dir(&target).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!(
            "A theme with id `{new_id}` is already installed at {}",
            target.display()
        ),
        _ => format!("Could not create {}: {e}", target.display()),
    })?;

    match copy_template(&source, &target, &manifest_json) {
        Ok(()) => Ok(new_id.to_string()),
        Err(e) => {
            // A half-copied theme would list as one that can't load.
            let _ = std::fs::remove_dir_all(&target);
            Err(e)
        }
    }
}

/// Copy every file under `source` into `target` at the same relative path,
/// writing `manifest_json` in place of the template's own root `theme.json`.
/// Depth and count are a template's own, so no archive limits apply here — but
/// the manifest is still rewritten rather than copied, so the new theme never
/// carries the template's id.
fn copy_template(source: &Path, target: &Path, manifest_json: &[u8]) -> Result<(), String> {
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

/// Every theme package this build ships as a starter template, for the "New
/// theme" picker. Reads the bundled manifests only — the live themes directory
/// is not consulted, so an installed theme can never appear here.
#[tauri::command]
pub fn list_starter_templates(app: AppHandle) -> Vec<ThemeSummary> {
    let root = match starter_templates_dir(&app) {
        Ok(root) => root,
        Err(e) => {
            // Never fatal: a build without the templates simply offers none.
            crate::log::log_line(&app, "theme", &e);
            return Vec::new();
        }
    };
    let scan = theme::scan(&root);
    for message in &scan.skipped {
        crate::log::log_line(&app, "theme", message);
    }
    scan.themes
}

/// Create a new theme from one of the bundled starter templates: a copy of the
/// template's own files under `new_id`, with the manifest's id and name
/// rewritten. Create-only, exactly as [`save_theme`].
#[tauri::command]
pub fn scaffold_theme_from_template(
    app: AppHandle,
    template_id: String,
    new_id: String,
    name: String,
) -> Result<String, String> {
    let starter_root = starter_templates_dir(&app)?;
    let id = scaffold_from_template(
        &starter_root,
        &crate::paths::themes_dir(&app),
        &template_id,
        &new_id,
        &name,
    )?;
    crate::log::log_line(
        &app,
        "theme",
        &format!("Created theme `{id}` from template `{template_id}`"),
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
/// provenance file itself excluded. Sorted so file-system iteration order
/// never changes the result.
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
            if at == Path::new(SEED_PROVENANCE_FILE) {
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
/// unchanged, unlike [`scaffold_from_template`], and records seed provenance
/// for it.
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

    let install = copy_template(&source, &target, &manifest_json).and_then(|()| {
        let manifest: ThemeManifest = serde_json::from_slice(&manifest_json)
            .map_err(|e| format!("Could not parse the bundled manifest for `{id}`: {e}"))?;
        write_seed_provenance(&target, &manifest.version)
    });

    match install {
        Ok(()) => Ok(id.to_string()),
        Err(e) => {
            // A half-copied theme would list as one that can't load.
            let _ = std::fs::remove_dir_all(&target);
            Err(e)
        }
    }
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
    fn remaining_ms_is_zero_once_the_deadline_has_passed() {
        let pending = PendingActivation {
            previous_id: None,
            new_id: None,
            delete_on_revert: false,
            deadline: Instant::now(),
        };

        assert_eq!(
            pending.remaining_ms(Instant::now() + Duration::from_secs(1)),
            0
        );
    }

    #[test]
    fn remaining_ms_counts_down_from_the_deadline() {
        let started = Instant::now();
        let pending = armed_at(started).unwrap();

        assert_eq!(
            pending.remaining_ms(started),
            ACTIVATION_WINDOW.as_millis() as u64
        );
        assert_eq!(
            pending.remaining_ms(started + Duration::from_secs(5)),
            10_000
        );
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

    /// The automatic-expiry path is a revert call arriving after the deadline,
    /// so revert (`take_any`) must succeed where confirm (`take_if_live`) refuses.
    #[test]
    fn an_expired_activation_cannot_be_confirmed_but_can_still_be_reverted() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let expired_at = started + ACTIVATION_WINDOW + Duration::from_millis(1);

        assert!(take_if_live(&mut slot, expired_at).is_none());
        assert!(slot.is_some(), "confirm must not have consumed it");

        let taken = take_any(&mut slot).expect("revert must still take an expired activation");
        assert_eq!(taken.new_id.as_deref(), Some("local.ember"));
        assert!(slot.is_none(), "revert leaves nothing pending behind");
    }

    /// Trying a second theme before answering replaces the pending one and restarts the clock.
    #[test]
    fn re_arming_replaces_the_pending_activation_and_restarts_the_clock() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let later = started + Duration::from_secs(10);
        arm(
            &mut slot,
            Some("local.ember".into()),
            Some("dev.pack".into()),
            false,
            later,
        );

        let pending = slot.as_ref().expect("still armed");
        assert_eq!(pending.new_id.as_deref(), Some("dev.pack"));
        assert_eq!(pending.previous_id.as_deref(), Some("local.ember"));
        assert_eq!(pending.deadline, later + ACTIVATION_WINDOW);
        assert_eq!(pending.remaining_ms(later), 15_000);
    }

    /// `arm` hands back whatever it displaces, so a caller can tell a fresh
    /// arm (nothing to clean up) from a re-arm (something was abandoned).
    #[test]
    fn arming_returns_the_previously_pending_activation_if_any() {
        let mut slot = None;
        let first = arm(
            &mut slot,
            None,
            Some("local.first".into()),
            true,
            Instant::now(),
        );
        assert!(first.is_none(), "nothing was pending yet");

        let second = arm(
            &mut slot,
            None,
            Some("local.second".into()),
            false,
            Instant::now(),
        );
        let displaced = second.expect("the first arm was displaced");
        assert_eq!(displaced.new_id.as_deref(), Some("local.first"));
        assert!(
            displaced.delete_on_revert,
            "carried the flag it was armed with"
        );
        assert_eq!(slot.unwrap().new_id.as_deref(), Some("local.second"));
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

        let issues = validate_theme_layouts(&dir).unwrap();

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

        let issues = validate_theme_settings(&dir).unwrap();

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

/// The bundled starter templates are real, shipped content: these hold them to
/// the codebase's own validators rather than to a description of them, so a
/// template that would not survive the pipeline it is meant to demonstrate
/// fails here.
#[cfg(test)]
mod starter_templates {
    use super::*;
    use crate::theme::archive;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// The templates as they ship, straight out of the crate's own
    /// `resources/` — the same directory `bundle.resources` copies.
    fn bundled() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/starter-themes")
    }

    /// A scratch directory unique to one test (no `tempfile` dependency), the
    /// way the rest of `theme` does it — never a real themes root.
    fn scratch(tag: &str) -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let seq = N.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("tetra-starter-{tag}-{nanos}-{seq}"));
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

    /// The directory zipped the way an exported theme package is, so it can go
    /// through the import pipeline exactly as one a user downloads would.
    fn zip_template(template_dir: &Path, dest: &Path) {
        let file = std::fs::File::create(dest).expect("could not create the package");
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in files_under(template_dir) {
            writer
                .start_file(name, options)
                .expect("could not add a file");
            writer.write_all(&bytes).expect("could not write a file");
        }
        writer.finish().expect("could not finish the package");
    }

    /// Every template this build ships, in the id order `theme::scan` reports.
    const TEMPLATES: [&str; 3] = ["starter.colours", "starter.layout", "starter.styled"];

    /// All three bundled templates are v2 packages, so none is flagged incompatible.
    #[test]
    fn every_bundled_template_is_listed_and_none_is_incompatible() {
        let scan = theme::scan(&bundled());

        assert!(scan.skipped.is_empty(), "{:?}", scan.skipped);
        let ids: Vec<&str> = scan.themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, TEMPLATES, "the shipped set, sorted by id");
        for theme in &scan.themes {
            assert!(!theme.incompatible, "{}: incompatible flag", theme.id);
        }
    }

    /// Each template's own files, through the validators the rest of the
    /// codebase would run them through.
    #[test]
    fn every_bundled_template_validates_as_an_installed_theme() {
        for id in TEMPLATES {
            let dir = bundled().join(id);

            // Reads the manifest, tokens.json and layout.json, and refuses the
            // same disagreements an installed theme is refused.
            let file = theme::get(&bundled(), id).unwrap_or_else(|e| panic!("{id}: {e}"));
            assert_eq!(file.manifest.id, id, "{id}: directory name is its id");
            assert_eq!(
                file.manifest.author, "Tetra Launcher",
                "{id}: authored by the project"
            );
            assert!(
                !file.manifest.description.trim().is_empty(),
                "{id}: says what it demonstrates"
            );
            assert_eq!(file.manifest.version, "1.0.0");

            // A palette must be complete: every token the frontend reads, in both
            // schemes, as a hex string — an absent one silently falls back to
            // neutral, which would make the template barely a theme. All three
            // templates are v2, so colours nest under `colors`.
            let is_v2 = file.tokens["schemaVersion"] == 2;
            for scheme in ["dark", "light"] {
                for token in [
                    "bg", "surface", "surface2", "border", "text", "muted", "muted2", "accent",
                    "accent2", "success", "warn", "danger",
                ] {
                    let value = if is_v2 {
                        &file.tokens["colors"][scheme][token]
                    } else {
                        &file.tokens[scheme][token]
                    };
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

            if dir.join(theme::STYLES_FILE).is_file() {
                let css = std::fs::read_to_string(dir.join(theme::STYLES_FILE)).unwrap();
                crate::theme::css::validate_css(&css)
                    .unwrap_or_else(|e| panic!("{id} styles.css: {e}"));
            }
        }
    }

    /// All three bundled starters are ordinary user-importable v2 packages:
    /// staged and installed through the same pipeline a downloaded theme goes through.
    #[test]
    fn the_bundled_v2_templates_import_successfully() {
        for id in TEMPLATES {
            let root = scratch(&format!("import-{id}"));
            let zip_path = root.join(format!("{id}.zip"));
            zip_template(&bundled().join(id), &zip_path);
            let staged = archive::stage_for_preview(&root, &zip_path, &[])
                .unwrap_or_else(|e| panic!("{id}: {e}"));
            assert_eq!(staged.manifest.id, id);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn scaffolding_copies_the_template_under_the_new_id_and_name() {
        let bundled = bundled();

        // All three, so Custom layout's nested `layout/` directory is covered
        // as well as the flat pair — it is the one a shallow copy would
        // silently drop. All three v2 starters omit `tier` (a v1 leftover the
        // struct defaults to empty).
        for (template_id, slug, tier) in [
            ("starter.colours", "colours", ""),
            ("starter.styled", "styled", ""),
            ("starter.layout", "layout", ""),
        ] {
            let themes_root = scratch(&format!("scaffold-{slug}"));
            let new_id = format!("local.my-{slug}");

            let id = scaffold_from_template(
                &bundled,
                &themes_root,
                template_id,
                &new_id,
                &format!("My {slug}"),
            )
            .expect("scaffold");

            assert_eq!(id, new_id);
            let created = theme::get(&themes_root, &new_id).expect("the new theme loads");
            assert_eq!(created.manifest.id, new_id);
            assert_eq!(created.manifest.name, format!("My {slug}"));
            assert_eq!(created.manifest.tier, tier);
            assert_eq!(
                created.manifest.author, "Tetra Launcher",
                "the template's own provenance is kept"
            );

            // Every file but the manifest is the template's, byte for byte —
            // including anything nested, which `theme::get` would not read.
            let source = bundled.join(template_id);
            let names = |files: Vec<(String, Vec<u8>)>| {
                files.into_iter().map(|(name, _)| name).collect::<Vec<_>>()
            };
            assert_eq!(
                names(files_under(&themes_root.join(&new_id))),
                names(files_under(&source)),
                "{template_id}: the copy holds exactly the template's files"
            );
            for (name, bytes) in files_under(&source) {
                if name == theme::MANIFEST_FILE {
                    continue;
                }
                assert_eq!(
                    std::fs::read(themes_root.join(&new_id).join(&name)).unwrap(),
                    bytes,
                    "{template_id}: `{name}` should have been copied unchanged"
                );
            }

            // ...and the palette arrives as the template's own.
            let template = theme::get(&bundled, template_id).unwrap();
            assert_eq!(created.tokens, template.tokens);

            // The template itself is untouched: same files, same declared id.
            let after = theme::scan(&bundled);
            assert!(after.skipped.is_empty(), "{:?}", after.skipped);
            assert!(after.themes.iter().any(|t| t.id == template_id));
            assert_eq!(
                theme::get(&bundled, template_id).unwrap().manifest.id,
                template_id
            );
            let _ = std::fs::remove_dir_all(&themes_root);
        }
    }

    /// Scaffolding is create-only, exactly as `save` is: an installed id is an
    /// error, never a silent overwrite of whatever is already there.
    #[test]
    fn scaffolding_onto_an_installed_id_is_refused_and_changes_nothing() {
        let themes_root = scratch("scaffold-taken");
        theme::save(
            &themes_root,
            &ThemeManifest {
                id: "local.taken".to_string(),
                name: "Already Here".to_string(),
                ..ThemeManifest::default()
            },
            &serde_json::json!({ "schemaVersion": 2, "colors": { "dark": {}, "light": {} } }),
        )
        .expect("seed the installed theme");

        let error = scaffold_from_template(
            &bundled(),
            &themes_root,
            "starter.colours",
            "local.taken",
            "Overwrite Me",
        )
        .expect_err("an installed id must be refused");

        assert!(error.contains("already installed"), "{error}");
        assert_eq!(
            theme::get(&themes_root, "local.taken")
                .unwrap()
                .manifest
                .name,
            "Already Here",
            "the installed theme survives the refusal"
        );
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// A template id or a new id that could name a path is refused before
    /// anything is created — the id becomes a directory name.
    #[test]
    fn an_unusable_template_or_new_id_creates_nothing() {
        let themes_root = scratch("scaffold-bad");
        let bundled = bundled();

        let error = scaffold_from_template(&bundled, &themes_root, "../../etc", "local.x", "X")
            .expect_err("a path is not a template id");
        assert!(
            error.contains("not a usable starter template id"),
            "{error}"
        );

        let error =
            scaffold_from_template(&bundled, &themes_root, "no.such.template", "local.x", "X")
                .expect_err("this build ships no such template");
        assert!(error.contains("no.such.template"), "{error}");

        let error =
            scaffold_from_template(&bundled, &themes_root, "starter.colours", "../escape", "X")
                .expect_err("a path is not a usable id");
        assert!(error.contains("not a usable theme id"), "{error}");

        assert!(!themes_root.join("local.x").exists());
        assert!(!themes_root.join("..").join("escape").exists());
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// The command's own file-count guard: a template's structure is what the
    /// picker's "what this demonstrates" text promises.
    #[test]
    fn each_template_ships_exactly_the_files_its_capabilities_declare() {
        let bundled = bundled();

        let expected: [(&str, &[&str], &[&str]); 3] = [
            (
                "starter.colours",
                &["theme.json", "tokens.json", "README.md"],
                &["tokens"],
            ),
            (
                "starter.styled",
                &[
                    "theme.json",
                    "tokens.json",
                    "styles.css",
                    "settings.schema.json",
                    "README.md",
                ],
                &["tokens", "css", "settings"],
            ),
            (
                "starter.layout",
                &[
                    "theme.json",
                    "tokens.json",
                    "styles.css",
                    "settings.schema.json",
                    "README.md",
                    "layout/shell.json",
                    "layout/settings.json",
                    "layout/views/browser.json",
                    "layout/views/mods.json",
                    "layout/lists/servers.json",
                    "layout/lists/mods.json",
                    "layout/lists/serverMods.json",
                    "layout/lists/modServers.json",
                    "layout/lists/modFilterResults.json",
                    "layout/modals/serverInfo.json",
                    "layout/modals/modFilter.json",
                    "layout/modals/update.json",
                ],
                &["tokens", "css", "layout", "settings"],
            ),
        ];
        for (id, files, capabilities) in expected {
            let dir = bundled.join(id);
            let mut present: Vec<String> = files_under(&dir)
                .into_iter()
                .map(|(name, _)| name)
                .collect();
            present.sort();
            let mut expected: Vec<String> = files.iter().map(|f| f.to_string()).collect();
            expected.sort();
            assert_eq!(present, expected, "{id} ships exactly its declared content");
            // The declared capabilities agree with the files that are there.
            let manifest = theme::get(&bundled, id).unwrap().manifest;
            assert_eq!(manifest.capabilities, capabilities, "{id}: capabilities");
        }
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
    /// directory name is id, exactly like the starter templates.
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
