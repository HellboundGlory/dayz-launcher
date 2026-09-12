//! Theme commands: listing, reading, installing and deleting file-backed
//! themes, plus the one-time import of themes the frontend used to keep in
//! `localStorage`.
//!
//! All the storage rules live in [`crate::theme`]; these wrappers resolve the
//! themes directory, log what the storage layer chose to skip, and turn a
//! refusal into an `Err` the frontend can show. Nothing here panics on
//! disk content — an unreadable theme is a message in the log, never a crash.

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

/// Validate a theme `.zip` the user picked and stage it for confirmation —
/// nothing is installed and no installed theme is touched. The staging
/// directory is left in place for `confirm_theme_install` to consume; a
/// package that fails validation leaves nothing behind. See
/// [`theme::archive`] for the checks and their order.
#[tauri::command]
pub fn import_theme_preview(
    app: AppHandle,
    zip_path: String,
) -> Result<theme::archive::ThemeImportPreview, String> {
    let themes_root = crate::paths::themes_dir(&app);
    // Scanned once here and passed down, so the classification compares
    // against the same list the dialog's "installed" grid is showing.
    let installed = theme::scan(&themes_root).themes;
    theme::archive::stage_for_preview(&themes_root, std::path::Path::new(&zip_path), &installed)
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
// Switching themes is applied live in the frontend, so a theme whose palette
// makes the app unusable would otherwise be permanent. The flow below splits a
// switch in two: `arm_activation` shows a small, theme-independent guard window
// (a fixed dark card — see `tauri.conf.json` and `capabilities/theme-guard.json`)
// and remembers the outgoing theme in memory, but writes nothing. Only
// `confirm_activation` touches `settings.json`. If the user can't see, or the
// window goes away without an answer, `revert_activation` throws the switch away
// and tells `main` to put the old theme back.

/// How long an unconfirmed activation stays up before the guard window gives up
/// and reverts. Long enough to read the window and hit a button; short enough
/// that a wedged frontend can't strand the app on an unusable palette.
const ACTIVATION_WINDOW: Duration = Duration::from_secs(15);

/// The guard window's label, as set in `tauri.conf.json` and scoped in
/// `capabilities/theme-guard.json`. One place, because three commands and the
/// config all have to agree on it.
const GUARD_WINDOW: &str = "theme-guard";

/// The window's size in logical pixels, mirrored by `width`/`height` in
/// `tauri.conf.json`. Only used when there is no config entry to take it from —
/// i.e. the first-use lazy build.
const GUARD_SIZE: (f64, f64) = (360.0, 140.0);

impl PendingActivation {
    /// What remains of the confirmation window. `saturating_` for the reason
    /// that matters here: the frontend polls this, so the first poll after the
    /// deadline has to read `0` ("expired") rather than panic on an underflow.
    fn remaining_ms(&self, now: Instant) -> u64 {
        self.deadline
            .saturating_duration_since(now)
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
}

/// A pending activation as the guard window reads it. `remainingMs` is computed
/// fresh per call from the stored deadline, never stored as a countdown: a
/// countdown would drift, and would freeze rather than advance across OS suspend.
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

/// Whether an armed activation is still inside its confirmation window. The
/// boundary is the same instant `remaining_ms` reports as `0`.
fn is_live(pending: &PendingActivation, now: Instant) -> bool {
    pending.deadline > now
}

/// What a poll sees: `Some` whenever something is armed — including an
/// activation whose deadline has passed, which reports `remainingMs: 0` so the
/// frontend can tell the difference between "counting down" and "expired".
/// Read-only, and that matters: the frontend decides the outcome.
fn read(pending: &Option<PendingActivation>, now: Instant) -> Option<ActivationStatus> {
    pending.as_ref().map(|p| ActivationStatus::of(p, now))
}

/// Take the pending activation, unless its window has already closed. Taking is
/// the point: an activation is answerable once, so a second click — or a
/// duplicate call from the guard window — finds nothing and no-ops rather than
/// confirming or reverting twice.
///
/// An expired activation is left in place rather than discarded, so the
/// frontend can still revert it after reading a `0` countdown.
fn take(subject: &mut Option<PendingActivation>, now: Instant) -> Option<PendingActivation> {
    match subject.as_ref() {
        Some(pending) if is_live(pending, now) => subject.take(),
        _ => None,
    }
}

/// Arm (or re-arm) the pending activation. `previous_id` is what a revert goes
/// back to; re-arming restarts the clock and replaces whatever was pending,
/// since only the latest preview is on screen and only the latest deserves a
/// decision. Nothing is written to disk here — [`confirm_activation`] is the
/// flow's only write.
fn arm(
    subject: &mut Option<PendingActivation>,
    previous_id: Option<String>,
    new_id: Option<String>,
    at: Instant,
) {
    *subject = Some(PendingActivation {
        previous_id,
        new_id,
        deadline: at + ACTIVATION_WINDOW,
    });
}

/// The guard window, if it exists. `build_guard_window` creates it on first use
/// so a session that never arms an activation never pays for it.
fn guard_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(GUARD_WINDOW)
}

/// The guard window, created if this is the first activation of the session.
///
/// Built from the same properties as its `tauri.conf.json` entry, and pointing
/// at a self-contained page: this window must render identically under every
/// theme, so it loads no stylesheet or component `main` uses and carries no
/// `data-tetra-slot`.
fn build_guard_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    tauri::WebviewWindowBuilder::new(
        app,
        GUARD_WINDOW,
        tauri::WebviewUrl::App("theme-guard.html".into()),
    )
    .title("Tetra Launcher")
    .inner_size(GUARD_SIZE.0, GUARD_SIZE.1)
    .center()
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

/// The guard window on screen, built on first use. Its `tauri.conf.json` entry
/// declares it hidden and the lazy build starts hidden too, so both paths need
/// this explicit `show` — a window created `visible: false` with no show after
/// it would never appear.
fn show_guard_window(app: &AppHandle) -> Result<(), String> {
    let window = match guard_window(app) {
        Some(window) => window,
        None => build_guard_window(app)?,
    };
    window
        .show()
        .map_err(|e| format!("Could not show the theme guard window: {e}"))
}

/// Hide the guard window after an activation has been answered. Missing window
/// is not an error: it may never have been built (nothing armed this session)
/// and hiding an already-hidden window is a no-op.
fn hide_guard_window(app: &AppHandle) {
    if let Some(window) = guard_window(app) {
        let _ = window.hide();
    }
}

/// Begin a theme activation: remember the outgoing theme and show the guard
/// window, writing nothing to disk. The frontend has already applied `new_id`
/// live; `previous_id` is read from settings so the revert path has somewhere
/// to go back to even though this command never persists anything itself.
///
/// Re-arming (the user tries another theme while one is pending) replaces the
/// pending activation and restarts the clock, rather than queueing: only the
/// latest preview is on screen, so only the latest deserves a decision.
#[tauri::command]
pub fn arm_activation(app: AppHandle, new_id: Option<String>) -> Result<(), String> {
    let previous_id = crate::commands::settings::current(&app).active_theme_id;

    {
        let state = app.state::<crate::state::AppState>();
        let mut slot = state
            .pending_theme
            .lock()
            .map_err(|_| "The pending theme activation lock is poisoned".to_string())?;
        arm(&mut slot, previous_id, new_id, Instant::now());
    }

    show_guard_window(&app)
}

/// Make the previewed theme permanent. This is the flow's only write to
/// `settings.json` — everything up to here has been in-memory and reversible.
///
/// Nothing pending is a no-op success, not an error: the guard window polls and
/// a user can double-click a button, and a stale call arriving after a revert
/// must not surface as a failure.
#[tauri::command]
pub fn confirm_activation(app: AppHandle) -> Result<(), String> {
    let armed = {
        let state = app.state::<crate::state::AppState>();
        let mut slot = state
            .pending_theme
            .lock()
            .map_err(|_| "The pending theme activation lock is poisoned".to_string())?;
        take(&mut slot, Instant::now())
    };

    if let Some(pending) = armed {
        // Built before the write, emitted only after it: formatting first keeps
        // the id from having to be cloned just to log it, and the line still
        // can't claim a confirmation that failed.
        let message = format!("Confirmed theme {:?}", pending.new_id);
        crate::commands::settings::set_active_theme_id(&app, pending.new_id)?;
        crate::log::log_line(&app, "theme", &message);
    }

    hide_guard_window(&app);
    Ok(())
}

/// Abandon the previewed theme: forget it, write nothing, and tell `main` to
/// re-apply the one that was active before. The event carries `previousId` so
/// the listener doesn't have to re-read settings to know what to go back to.
///
/// Nothing pending is a no-op success, for the same double-click reason as
/// [`confirm_activation`] — and because the expired-status path can fire this
/// more than once.
#[tauri::command]
pub fn revert_activation(app: AppHandle) -> Result<(), String> {
    let armed = {
        let state = app.state::<crate::state::AppState>();
        let mut slot = state
            .pending_theme
            .lock()
            .map_err(|_| "The pending theme activation lock is poisoned".to_string())?;
        take(&mut slot, Instant::now())
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
    }

    hide_guard_window(&app);
    Ok(())
}

/// The pending activation, for the guard window's countdown poll. Read-only:
/// confirming or reverting is the caller's decision, and this command never
/// makes one. `remainingMs` reads `0` once the deadline has passed rather than
/// wrapping or panicking.
#[tauri::command]
pub fn get_activation_status(app: AppHandle) -> Option<ActivationStatus> {
    let state = app.state::<crate::state::AppState>();
    let armed = state.pending_theme.lock().ok()?;
    read(&armed, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An armed activation, for the transition tests below. `previous_id` is
    /// the built-in default (`None`) so the `null` case is the one exercised.
    fn armed_at(at: Instant) -> Option<PendingActivation> {
        let mut slot = None;
        arm(&mut slot, None, Some("local.ember".into()), at);
        slot
    }

    /// The whole reason `remainingMs` is computed from the deadline on every
    /// read rather than counted down: the poll that lands after the deadline
    /// has to report an expiry. A subtraction that wrapped (or an `as_millis`
    /// cast on a negative duration) would instead read as an enormous window.
    #[test]
    fn remaining_ms_is_zero_once_the_deadline_has_passed() {
        let pending = PendingActivation {
            previous_id: None,
            new_id: None,
            deadline: Instant::now(),
        };

        assert_eq!(
            pending.remaining_ms(Instant::now() + Duration::from_secs(1)),
            0
        );
    }

    /// Mid-window the remainder matches the deadline, so the countdown the
    /// frontend draws is the one that was actually armed.
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

    /// A live activation is reported with the ids it was armed with, in the
    /// shape the guard window deserialises — an arm with no previous theme (the
    /// built-in default) serialises `null`, not an empty string.
    #[test]
    fn a_pending_activation_serialises_with_the_ids_it_was_armed_with() {
        let pending = armed_at(Instant::now()).unwrap();

        let json = serde_json::to_value(ActivationStatus::of(&pending, Instant::now())).unwrap();

        assert_eq!(json["previousId"], serde_json::Value::Null);
        assert_eq!(json["newId"], "local.ember");
        assert!(json["remainingMs"].as_u64().unwrap() > 0);
        assert!(json["remainingMs"].as_u64().unwrap() <= ACTIVATION_WINDOW.as_millis() as u64);
    }

    /// Polling is what the guard window does four times a second, so it has to
    /// be invisible to the flow: a poll that consumed the activation would make
    /// the user's confirm land on nothing and silently lose the switch.
    #[test]
    fn reading_the_status_leaves_the_activation_armed() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let first = read(&slot, started).expect("armed");
        let second = read(&slot, started + Duration::from_secs(3)).expect("still armed");

        assert_eq!(second.remaining_ms, first.remaining_ms - 3_000);

        // Still answerable after all that polling, which is the point.
        let taken = take(&mut slot, started + Duration::from_secs(4)).expect("still takeable");
        assert_eq!(taken.new_id.as_deref(), Some("local.ember"));
    }

    /// The confirm path: a live activation is handed over exactly once, and the
    /// second (stale, double-clicked) call finds nothing rather than confirming
    /// twice.
    #[test]
    fn confirming_takes_a_live_activation_once() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let taken = take(&mut slot, started + Duration::from_secs(1)).expect("armed");

        assert_eq!(taken.new_id.as_deref(), Some("local.ember"));
        assert_eq!(taken.previous_id, None);
        assert!(slot.is_none());
        assert!(take(&mut slot, started + Duration::from_secs(2)).is_none());
    }

    /// An expired activation is not answerable — the deadline is what makes the
    /// prompt stop accepting clicks.
    #[test]
    fn an_expired_activation_cannot_be_confirmed() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let expired_at = started + ACTIVATION_WINDOW + Duration::from_millis(1);

        assert!(take(&mut slot, expired_at).is_none());
        // Still armed, so the revert that follows the `0` countdown has
        // something to act on.
        assert!(slot.is_some());
    }

    /// Re-arming mid-preview (the user tries a second theme before answering)
    /// replaces the pending activation and restarts the clock, rather than
    /// queueing a decision for a preview that is no longer on screen.
    #[test]
    fn re_arming_replaces_the_pending_activation_and_restarts_the_clock() {
        let started = Instant::now();
        let mut slot = armed_at(started);

        let later = started + Duration::from_secs(10);
        arm(
            &mut slot,
            Some("local.ember".into()),
            Some("dev.pack".into()),
            later,
        );

        let pending = slot.as_ref().expect("still armed");
        assert_eq!(pending.new_id.as_deref(), Some("dev.pack"));
        assert_eq!(pending.previous_id.as_deref(), Some("local.ember"));
        assert_eq!(pending.deadline, later + ACTIVATION_WINDOW);
        assert_eq!(pending.remaining_ms(later), 15_000);
    }

    /// Nothing armed is the state the no-op paths run in: no status, nothing to
    /// take, and no panic — a stray confirm or revert after the flow settled
    /// must be an uneventful success.
    #[test]
    fn nothing_armed_reads_and_takes_as_nothing() {
        let mut slot: Option<PendingActivation> = None;
        let now = Instant::now();

        assert!(read(&slot, now).is_none());
        assert!(take(&mut slot, now).is_none());
    }
}
