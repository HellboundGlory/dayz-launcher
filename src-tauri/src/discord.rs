//! Wiring for `tetra_discord`'s Rich Presence handle into the app: the
//! client ID, starting the background connection, and the poll loop that
//! flips between "Browsing servers" and "Playing on X" depending on whether
//! a session this launcher started is still running.

use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Tetra Launcher's Discord Application ID. Not a secret — sent in every
/// Rich Presence client's handshake.
const CLIENT_ID: &str = "1536147518319239239";

/// How often the poll loop reconciles presence with whether DayZ is still running.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Ticks between idle-count refreshes (~60s); fires on tick 0 too.
const IDLE_REFRESH_EVERY_N_TICKS: u32 = 12;

/// How long a `Live` session may go unconfirmed as a real process before
/// giving up and reverting to idle. Generous since DayZ startup (BattlEye,
/// shaders, Proton) can take a minute or more.
const CONFIRM_RUNNING_TIMEOUT_SECS: i64 = 180;

/// Seed `AppState` from the saved setting and start the poll loop. Called
/// once, from `setup`.
pub fn start(app: &AppHandle, enabled: bool) {
    let state = app.state::<crate::state::AppState>();
    state.discord_enabled.store(enabled, Ordering::Relaxed);
    if enabled {
        ensure_handle(app);
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(POLL_INTERVAL);
        let mut tick: u32 = 0;
        // Whether the current `Live` session has ever been observed actually running.
        let mut confirmed_running = false;
        // Last presence state reported to the log, so we log transitions not every tick.
        let mut reported = ReportedState::Idle;
        loop {
            interval.tick().await;
            poll_once(
                &app,
                tick % IDLE_REFRESH_EVERY_N_TICKS == 0,
                &mut confirmed_running,
                &mut reported,
            )
            .await;
            tick = tick.wrapping_add(1);
        }
    });
}

/// Create the presence handle if one isn't already running. Idempotent, so
/// both `start` and `enable` can call it without checking first.
fn ensure_handle(app: &AppHandle) {
    let state = app.state::<crate::state::AppState>();
    let Ok(mut guard) = state.discord.lock() else {
        return;
    };
    if guard.is_none() {
        let log_app = app.clone();
        *guard = Some(tetra_discord::DiscordHandle::start(CLIENT_ID, move |msg| {
            crate::log::log_line(&log_app, "discord", msg);
        }));
    }
}

/// Turn the feature on for the rest of this session — called from
/// `save_settings` when the toggle flips from off to on.
pub fn enable(app: &AppHandle) {
    let state = app.state::<crate::state::AppState>();
    state.discord_enabled.store(true, Ordering::Relaxed);
    ensure_handle(app);
}

/// Turn the feature off. Clears the presence but leaves the connection
/// thread running (cheap idle, avoids a fresh handshake on re-enable).
pub fn disable(app: &AppHandle) {
    let state = app.state::<crate::state::AppState>();
    state.discord_enabled.store(false, Ordering::Relaxed);
    if let Ok(guard) = state.discord.lock() {
        if let Some(handle) = guard.as_ref() {
            handle.clear();
        }
    }
    let Ok(mut playing) = state.discord_now_playing.lock() else {
        return;
    };
    *playing = None;
}

/// Clear a "Checking mods" presence after a failed launch, called by
/// `commands::launch::launch_game` on every failure path. Pushes idle
/// immediately rather than waiting for the poll loop's next tick.
pub fn clear_launch_presence(app: &AppHandle) {
    let state = app.state::<crate::state::AppState>();
    if let Ok(mut session) = state.discord_now_playing.lock() {
        *session = None;
    }
    let Ok(guard) = state.discord.lock() else {
        return;
    };
    if let Some(handle) = guard.as_ref() {
        handle.set_idle(None);
    }
}

/// Which of the three presence states was last written to the log —
/// `poll_once` logs only when this changes, not every tick.
#[derive(PartialEq, Clone, Copy)]
enum ReportedState {
    Idle,
    Verifying,
    Live,
}

/// One tick of the poll loop: reconcile the presence with whether DayZ is
/// actually running right now, and — every `IDLE_REFRESH_EVERY_N_TICKS`th
/// tick — refresh the idle server count.
async fn poll_once(
    app: &AppHandle,
    refresh_idle_count: bool,
    confirmed_running: &mut bool,
    reported: &mut ReportedState,
) {
    let state = app.state::<crate::state::AppState>();
    if !state.discord_enabled.load(Ordering::Relaxed) {
        return;
    }
    let handle = {
        let Ok(guard) = state.discord.lock() else {
            return;
        };
        guard.clone()
    };
    let Some(handle) = handle else { return };

    // Peek before the lock-and-act block below: the guard is `!Send` and
    // can't be held across the `.await` that the process check needs.
    let live_started_at = {
        let Ok(session) = state.discord_now_playing.lock() else {
            return;
        };
        match session.as_ref() {
            Some(tetra_discord::DiscordSession::Live(info)) => Some(info.started_at),
            _ => None,
        }
    };
    // `dayz_running_since`, not plain `dayz_is_running`: a crashed process
    // can linger enumerable after the player stopped — see `tetra_launch::running`.
    let running = match live_started_at {
        Some(started_at) => tokio::task::spawn_blocking(move || {
            tetra_launch::running::dayz_running_since(started_at)
        })
        .await
        .unwrap_or(false),
        None => false,
    };

    // Block-scoped (not `drop()`) so the `!Send` guard lexically ends before
    // the `.await`s below.
    let (already_idle, send_idle_now) = {
        let Ok(mut session) = state.discord_now_playing.lock() else {
            return;
        };
        // Distinct from `already_idle`: a session that just became idle
        // this tick must be told immediately, not on the periodic refresh cadence.
        let mut send_idle_now = false;
        let already_idle = match session.clone() {
            // Mod gate running — keep showing it regardless of `running`. A
            // failed gate is cleared by `launch_game` itself, not here.
            Some(tetra_discord::DiscordSession::Verifying { server_name }) => {
                if *reported != ReportedState::Verifying {
                    crate::log::log_line(app, "discord", &format!("verifying: {server_name}"));
                    *reported = ReportedState::Verifying;
                }
                *confirmed_running = false;
                handle.set_verifying(server_name);
                false
            }
            // Only a running -> not-running transition counts as a real
            // exit; DayZ can take well past one POLL_INTERVAL to appear as
            // a process after launch, so "not running yet" isn't "exited".
            Some(tetra_discord::DiscordSession::Live(info)) => {
                if *reported != ReportedState::Live {
                    crate::log::log_line(
                        app,
                        "discord",
                        &format!(
                            "live: {} (process not yet confirmed running)",
                            info.server_name
                        ),
                    );
                    *reported = ReportedState::Live;
                }
                let was_confirmed = *confirmed_running;
                if running {
                    *confirmed_running = true;
                }
                if !was_confirmed && *confirmed_running {
                    crate::log::log_line(app, "discord", "process confirmed running");
                }
                let gave_up_waiting = !*confirmed_running
                    && unix_now().saturating_sub(info.started_at) > CONFIRM_RUNNING_TIMEOUT_SECS;
                if (!running && *confirmed_running) || gave_up_waiting {
                    if gave_up_waiting {
                        crate::log::log_line(
                            app,
                            "discord",
                            &format!(
                                "process never confirmed running after {CONFIRM_RUNNING_TIMEOUT_SECS}s \
                                 (dayz_running_since never returned true) -> idle"
                            ),
                        );
                    } else {
                        crate::log::log_line(app, "discord", "process no longer running -> idle");
                    }
                    *session = None;
                    send_idle_now = true;
                    true
                } else {
                    handle.set_playing(info);
                    false
                }
            }
            // Idle already, or a session this launcher didn't start — ordinary case.
            None => {
                *reported = ReportedState::Idle;
                *confirmed_running = false;
                true
            }
        };
        (already_idle, send_idle_now)
    };

    if send_idle_now || (already_idle && refresh_idle_count) {
        let count = match crate::commands::server::reader(&state) {
            Ok(reader) => tokio::task::spawn_blocking(move || reader.counts().ok())
                .await
                .ok()
                .flatten()
                .map(|(total, _populated)| total),
            Err(_) => None,
        };
        handle.set_idle(count);
    }
}

/// Current Unix time in seconds. Falls back to `0` on a clock error.
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
