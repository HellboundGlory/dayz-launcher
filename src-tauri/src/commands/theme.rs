//! Theme commands: list/read/install/delete file-backed themes, plus the
//! legacy `localStorage` import. Storage rules live in [`crate::theme`]; these
//! wrappers resolve the themes directory and log what got skipped.

use std::time::{Duration, Instant};
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
