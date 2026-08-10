//! Wiring for `tetra_discord`'s Rich Presence handle into the app: the
//! client ID, starting the background connection, and the poll loop that
//! flips between "Browsing servers" and "Playing on X" depending on whether
//! a session this launcher started is still running.

use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Tetra Launcher's Discord Application ID
/// (discord.com/developers/applications). Not a secret — every Rich Presence
/// client sends this in its handshake, the same way `DAYZ_APP_ID` identifies
/// the game to Steam.
const CLIENT_ID: &str = "1536147518319239239";

/// How often the poll loop checks whether a launched session is still
/// running, and reconciles the presence with it.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// How many `POLL_INTERVAL` ticks between idle-count refreshes (~60s). The
/// registry size changes slowly enough that re-reading it every 5s would
/// just be wasted queries — this fires on the very first tick too, so the
/// count appears promptly after startup rather than only after a minute.
const IDLE_REFRESH_EVERY_N_TICKS: u32 = 12;

/// How long a `Live` session is allowed to go without ever being confirmed
/// as an actual running process before the poll loop gives up on it and
/// reverts to idle. Generous on purpose — DayZ's own startup (BattlEye,
/// shader compilation, Proton on Linux) can legitimately take a minute or
/// more — this only exists so a launch that silently never produces a real
/// process doesn't leave the presence stuck on "Playing" for the rest of
/// the session with nothing left to correct it.
const CONFIRM_RUNNING_TIMEOUT_SECS: i64 = 180;

/// Seed `AppState` from the saved setting and start the poll loop.
///
/// Called once, from `setup`. The connection itself is only opened if the
/// setting allows it — a player who has the feature off should see the
/// launcher make no attempt to reach Discord at all, not a connection that
/// is silently never told anything.
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
        // Whether the *current* `Live` session has ever been observed
        // actually running. DayZ routinely takes well over `POLL_INTERVAL`
        // to appear as a process after `spawn_dayz` returns — see
        // `poll_once` for why this has to gate the exit check.
        let mut confirmed_running = false;
        loop {
            interval.tick().await;
            poll_once(
                &app,
                tick % IDLE_REFRESH_EVERY_N_TICKS == 0,
                &mut confirmed_running,
            )
            .await;
            tick = tick.wrapping_add(1);
        }
    });
}

/// Create the presence handle if one is not already running.
///
/// Idempotent, so both `start` (setting already on) and `enable` (user just
/// turned it on this session) can call it without checking first.
fn ensure_handle(app: &AppHandle) {
    let state = app.state::<crate::state::AppState>();
    let Ok(mut guard) = state.discord.lock() else {
        return;
    };
    if guard.is_none() {
        *guard = Some(tetra_discord::DiscordHandle::start(CLIENT_ID));
    }
}

/// Turn the feature on for the rest of this session — called from
/// `save_settings` when the toggle flips from off to on.
pub fn enable(app: &AppHandle) {
    let state = app.state::<crate::state::AppState>();
    state.discord_enabled.store(true, Ordering::Relaxed);
    ensure_handle(app);
}

/// Turn the feature off — called from `save_settings` when the toggle flips
/// from on to off.
///
/// Clears whatever Discord is currently showing but leaves the connection
/// thread itself running: it costs nothing idle, and re-enabling later
/// should not pay for a fresh handshake.
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

/// Clear a "Checking mods" presence that a failed launch must not leave
/// stranded — called by `commands::launch::launch_game` on every failure
/// path after it has set `DiscordSession::Verifying`.
///
/// Distinct from `disable`: this doesn't touch `discord_enabled` or need the
/// caller to hold a `DiscordHandle`, and it pushes idle immediately rather
/// than waiting for the poll loop's next tick — a failed launch is exactly
/// the kind of transition `discord.rs`'s module doc promises isn't left
/// stranded.
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

/// One tick of the poll loop: reconcile the presence with whether DayZ is
/// actually running right now, and — every `IDLE_REFRESH_EVERY_N_TICKS`th
/// tick — refresh the idle server count.
async fn poll_once(app: &AppHandle, refresh_idle_count: bool, confirmed_running: &mut bool) {
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

    // Off the main/async-runtime thread: this enumerates every process on
    // the system, the same cost `dayz_running` already pays per frontend
    // poll.
    let running = tokio::task::spawn_blocking(tetra_launch::running::dayz_is_running)
        .await
        .unwrap_or(false);

    // Scoped to a block, not just an explicit `drop`: a `std::sync::
    // MutexGuard` is `!Send`, and this function is later `.await`ed from
    // elsewhere, so the guard's lifetime has to *lexically* end here — a
    // `drop()` call left the compiler unable to prove it wasn't still live
    // across the `.await`s below.
    let (already_idle, send_idle_now) = {
        let Ok(mut session) = state.discord_now_playing.lock() else {
            return;
        };
        // `send_idle_now` is distinct from `already_idle`: a session that
        // just *became* idle this tick (the game exited) must be told
        // immediately, not on whatever cadence the periodic count refresh
        // happens to be on — otherwise a session ending could leave Discord
        // showing "Playing" for up to a minute after the fact.
        let mut send_idle_now = false;
        let already_idle = match session.clone() {
            // The mod gate is running — keep showing it regardless of
            // `running` (DayZ has not started yet, so `running` is false
            // throughout a verification that hasn't failed). A *failed*
            // gate is cleared, and pushed to idle immediately, by
            // `launch_game` itself — not here, since this loop has no way
            // to tell "still verifying" apart from "just failed and nobody
            // has told Discord yet" on its own. Reset the latch below: this
            // is the start of a session nothing has confirmed running yet.
            Some(tetra_discord::DiscordSession::Verifying { server_name }) => {
                *confirmed_running = false;
                handle.set_verifying(server_name);
                false
            }
            // `launch_game` sets this the moment `spawn_dayz` returns —
            // which is *not* the moment DayZ actually has a running process.
            // BattlEye's launcher stub, shader compilation and Proton on
            // Linux routinely take well past one `POLL_INTERVAL` before
            // `dayz_is_running` sees anything, so a single "not running yet"
            // reading right after launch must not be read as "already
            // exited" — that previously reverted the presence to idle
            // before the game had even finished starting, and it never
            // recovered from there. Only a *running → not running*
            // transition (the latch was set, and now isn't) is a real exit.
            Some(tetra_discord::DiscordSession::Live(info)) => {
                if running {
                    *confirmed_running = true;
                }
                let gave_up_waiting = !*confirmed_running
                    && unix_now().saturating_sub(info.started_at) > CONFIRM_RUNNING_TIMEOUT_SECS;
                if (!running && *confirmed_running) || gave_up_waiting {
                    *session = None;
                    send_idle_now = true;
                    true
                } else {
                    handle.set_playing(info);
                    false
                }
            }
            // Nothing recorded: either idle already, or DayZ is running a
            // session this launcher didn't start (launched from Steam
            // directly) — nothing to attribute a server to, so this is the
            // ordinary idle case, not an error.
            None => {
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

/// Current Unix time in seconds, matching `PresenceInfo::started_at`'s unit.
/// Falls back to `0` on a clock error, which just makes `gave_up_waiting`
/// trip immediately rather than panicking — acceptable for a bound that only
/// exists as a last-resort safety net.
fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
