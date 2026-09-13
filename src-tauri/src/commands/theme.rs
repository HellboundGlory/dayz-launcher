//! Theme commands: list/read/install/delete file-backed themes, plus the
//! legacy `localStorage` import and scaffolding a new theme from a bundled
//! starter template. Storage rules live in [`crate::theme`]; these wrappers
//! resolve the themes directory and log what got skipped.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::PendingActivation;
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
    layout: Option<serde_json::Value>,
) -> Result<String, String> {
    let id = theme::save(
        &crate::paths::themes_dir(&app),
        &manifest,
        &tokens,
        layout.as_ref(),
    )?;
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
const GUARD_SIZE: (f64, f64) = (360.0, 140.0);

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
    .transparent(true)
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
    if let Some(displaced) = displaced.filter(|d| d.new_id != new_id) {
        delete_orphaned_duplicate(&app, &displaced);
    }

    show_guard_window(&app)
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
        let _ = app.emit(
            "theme-activation-reverted",
            serde_json::json!({ "previousId": pending.previous_id }),
        );
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

/// The pending activation, for the guard window's countdown poll. Read-only —
/// confirming or reverting is the caller's decision.
#[tauri::command]
pub fn get_activation_status(app: AppHandle) -> Option<ActivationStatus> {
    let state = app.state::<crate::state::AppState>();
    let armed = state.pending_theme.lock().ok()?;
    read(&armed, Instant::now())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn armed_at(at: Instant) -> Option<PendingActivation> {
        let mut slot = None;
        arm(&mut slot, None, Some("local.ember".into()), false, at);
        slot
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

    /// What a template's directory ships, as `(relative path, text)`, for every
    /// file a theme's schema actually reads.
    fn json_file(template_dir: &Path, name: &str) -> serde_json::Value {
        let path = template_dir.join(name);
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{} is missing: {e}", path.display()));
        serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", path.display()))
    }

    /// Every template this build ships, in the id order `theme::scan` reports.
    const TEMPLATES: [&str; 3] = ["starter.advanced", "starter.basic", "starter.expert"];

    #[test]
    fn every_bundled_template_is_listed_with_its_declared_tier() {
        let scan = theme::scan(&bundled());

        assert!(scan.skipped.is_empty(), "{:?}", scan.skipped);
        let ids: Vec<&str> = scan.themes.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, TEMPLATES, "the shipped set, sorted by id");
        let tiers: Vec<&str> = scan.themes.iter().map(|t| t.tier.as_str()).collect();
        assert_eq!(tiers, ["advanced", "basic", "expert"]);
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
            assert_eq!(file.manifest.theme_api, archive::SUPPORTED_THEME_API_RANGE);

            // A palette must be complete: every token the frontend reads, in both
            // schemes, as a hex string — an absent one silently falls back to
            // neutral, which would make the template barely a theme.
            for scheme in ["dark", "light"] {
                for token in [
                    "bg", "surface", "surface2", "border", "text", "muted", "muted2", "accent",
                    "accent2", "success", "warn", "danger",
                ] {
                    let value = &file.tokens[scheme][token];
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

            if let Some(layout) = &file.layout {
                theme::validate_layout(layout).unwrap_or_else(|e| panic!("{id}: {e}"));
            }
            if dir.join(theme::STYLES_FILE).is_file() {
                let css = std::fs::read_to_string(dir.join(theme::STYLES_FILE)).unwrap();
                crate::theme::css::validate_css(&css)
                    .unwrap_or_else(|e| panic!("{id} styles.css: {e}"));
            }
        }
    }

    /// The Basic and Advanced templates are accepted by the *import* pipeline,
    /// not merely readable — the tier gate included.
    #[test]
    fn the_basic_and_advanced_templates_are_valid_import_packages() {
        for (id, expected_files, expected_capabilities) in [
            ("starter.basic", 2, vec!["tokens"]),
            ("starter.advanced", 4, vec!["tokens", "layout", "css"]),
        ] {
            let root = scratch(id);
            let zip_path = root.join(format!("{id}.zip"));
            zip_template(&bundled().join(id), &zip_path);

            let preview = archive::stage_for_preview(&root, &zip_path, &[])
                .unwrap_or_else(|e| panic!("{id} must be a valid package: {e}"));

            assert_eq!(preview.manifest.id, id);
            assert_eq!(preview.classification, "new");
            assert_eq!(
                preview.file_count, expected_files,
                "{id}: theme.json + what it ships"
            );
            assert_eq!(preview.manifest.capabilities, expected_capabilities);
            // The staged copy is a real theme on disk, not just a parsed header:
            // its own manifest and palette are what the install step will move.
            let staged = root.join(".staging").join(&preview.staging_id);
            let staged_manifest: ThemeManifest = serde_json::from_str(
                &std::fs::read_to_string(staged.join(theme::MANIFEST_FILE)).unwrap(),
            )
            .expect("the staged manifest is valid");
            assert_eq!(staged_manifest.id, id);
            let tokens: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(staged.join(theme::TOKENS_FILE)).unwrap(),
            )
            .expect("the staged palette is valid JSON");
            theme::validate_tokens(&tokens).expect("the staged palette is a palette");
            let _ = std::fs::remove_dir_all(&root);
        }
    }

    /// Expert is not yet loadable by this build, so the import pipeline stops it
    /// at the tier gate — and *only* there: the package itself is structurally
    /// valid, which is what the other expert test proves.
    #[test]
    fn the_expert_template_is_refused_by_the_tier_gate_alone() {
        let root = scratch("expert-tier");
        let zip_path = root.join("starter.expert.zip");
        zip_template(&bundled().join("starter.expert"), &zip_path);

        let error = archive::stage_for_preview(&root, &zip_path, &[])
            .expect_err("expert is not in SUPPORTED_TIERS yet");

        assert!(error.contains("expert"), "{error}");
        assert!(error.contains("newer Tetra Launcher"), "{error}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scaffolding_copies_the_template_under_the_new_id_and_name() {
        let bundled = bundled();

        // All three, so the Expert package's nested `components/` directory is
        // covered as well as the flat pair — it is the one a shallow copy would
        // silently drop.
        for (template_id, tier) in [
            ("starter.basic", "basic"),
            ("starter.advanced", "advanced"),
            ("starter.expert", "expert"),
        ] {
            let themes_root = scratch(&format!("scaffold-{tier}"));
            let new_id = format!("local.my-{tier}");

            let id = scaffold_from_template(
                &bundled,
                &themes_root,
                template_id,
                &new_id,
                &format!("My {tier}"),
            )
            .expect("scaffold");

            assert_eq!(id, new_id);
            let created = theme::get(&themes_root, &new_id).expect("the new theme loads");
            assert_eq!(created.manifest.id, new_id);
            assert_eq!(created.manifest.name, format!("My {tier}"));
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

            // ...and the palette and layout arrive as the template's own.
            let template = theme::get(&bundled, template_id).unwrap();
            assert_eq!(created.tokens, template.tokens);
            assert_eq!(created.layout, template.layout);

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
            &serde_json::json!({ "schemaVersion": 1, "dark": {}, "light": {} }),
            None,
        )
        .expect("seed the installed theme");

        let error = scaffold_from_template(
            &bundled(),
            &themes_root,
            "starter.basic",
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
            scaffold_from_template(&bundled, &themes_root, "starter.basic", "../escape", "X")
                .expect_err("a path is not a usable id");
        assert!(error.contains("not a usable theme id"), "{error}");

        assert!(!themes_root.join("local.x").exists());
        assert!(!themes_root.join("..").join("escape").exists());
        let _ = std::fs::remove_dir_all(&themes_root);
    }

    /// The command's own file-count guard: a template's structure is what the
    /// picker's "what this demonstrates" text promises.
    #[test]
    fn each_template_ships_exactly_the_files_its_tier_declares() {
        let bundled = bundled();

        let expected: [(&str, &[&str]); 3] = [
            ("starter.basic", &["theme.json", "tokens.json"]),
            (
                "starter.advanced",
                &["theme.json", "tokens.json", "layout.json", "styles.css"],
            ),
            (
                "starter.expert",
                &[
                    "theme.json",
                    "tokens.json",
                    "layout.json",
                    "styles.css",
                    "components/server-row.json",
                    "settings.schema.json",
                ],
            ),
        ];
        for (id, files) in expected {
            let dir = bundled.join(id);
            let mut present: Vec<String> = files_under(&dir)
                .into_iter()
                .map(|(name, _)| name)
                .collect();
            present.sort();
            let mut expected: Vec<String> = files.iter().map(|f| f.to_string()).collect();
            expected.sort();
            assert_eq!(present, expected, "{id} ships exactly its declared content");
            // The tier in the manifest agrees with the files that are there.
            let manifest = theme::get(&bundled, id).unwrap().manifest;
            assert_eq!(manifest.tier, id.trim_start_matches("starter."));
        }
    }

    /// The two subject files of the Expert tier, held to §4.3/§4.4's own shape —
    /// the vocabulary is closed, and a `core` leaf names a real child. The
    /// frontend's half of this (do those refs exist in `slots.ts`?) is
    /// `starter-templates.test.ts`, since the registry lives there.
    #[test]
    fn the_expert_template_uses_only_the_documented_components_and_settings_shapes() {
        let dir = bundled().join("starter.expert");

        let component = json_file(&dir, "components/server-row.json");
        assert_eq!(component["slot"], "server.row");
        let mut core_refs = Vec::new();
        walk_component(&component["root"], &mut core_refs);
        assert!(
            core_refs.iter().all(|r| !r.trim().is_empty()),
            "every core ref names a child: {core_refs:?}"
        );
        assert!(
            core_refs.len() >= 3,
            "a composition demonstrates the shape: {core_refs:?}"
        );

        let schema = json_file(&dir, "settings.schema.json");
        let fields = schema["fields"]
            .as_array()
            .expect("settings.schema.json holds `fields`");
        assert_eq!(fields.len(), 2, "one number field and one boolean field");
        let by_type = |wanted: &str| {
            fields
                .iter()
                .find(|f| f["type"] == wanted)
                .unwrap_or_else(|| panic!("no {wanted} field"))
        };
        let number = by_type("number");
        assert!(number["min"].is_number() && number["max"].is_number());
        assert!(number["default"].is_number());
        assert_eq!(number["id"], "accentHue");
        let boolean = by_type("boolean");
        assert!(boolean["default"].is_boolean());
        assert_eq!(boolean["id"], "compactRows");
    }

    /// Walks a §4.3 tree, refusing anything outside the closed vocabulary. Every
    /// leaf is a `core` naming a child; `stack`/`box`/`grid` only hold children.
    fn walk_component(node: &serde_json::Value, core_refs: &mut Vec<String>) {
        let kind = node["type"].as_str().expect("every node declares a `type`");
        match kind {
            "core" => core_refs.push(
                node["ref"]
                    .as_str()
                    .expect("a core leaf names its child in `ref`")
                    .to_string(),
            ),
            "stack" | "box" | "grid" => {
                for child in node["children"]
                    .as_array()
                    .unwrap_or_else(|| panic!("{kind} holds its children in an array"))
                {
                    walk_component(child, core_refs);
                }
            }
            other => panic!("`{other}` is not in the primitive vocabulary"),
        }
    }
}
