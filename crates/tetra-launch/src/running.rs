//! Whether DayZ is running right now.
//!
//! The launcher spawns the game and returns immediately — [`crate::spawn`]
//! explains at length why it does not wait — which leaves it with no idea
//! whether a session it started is still going. Everything downstream of a
//! launch used to be inferred from a 15-second timer.
//!
//! Asking the OS instead means the answer is also right for a session the
//! launcher had nothing to do with: DayZ started from Steam directly, or a
//! session that survived the launcher being closed and reopened.

use std::ffi::OsStr;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

/// The processes that *are* the game.
///
/// On Windows the game runs as `DayZ_x64.exe`. Under Proton (Linux) the same
/// binary renames its main process to `enfMain` (the Enfusion engine main
/// process), so both names mean "a session is live". Deliberately NOT
/// `DayZ_BE.exe` — that is the BattlEye launcher stub, which hands off and
/// exits within seconds, so watching it would report a session for a moment and
/// then lose it while the player was still in game.
const GAME_PROCESSES: &[&str] = &["DayZ_x64.exe", "enfMain"];

/// Whether a DayZ process exists on this machine.
///
/// Cheap enough to poll every few seconds: the refresh is asked for
/// [`ProcessRefreshKind::nothing`], so it collects names and nothing else — no
/// CPU sampling, no memory accounting, no command lines. Builds a fresh
/// [`System`] each call; a caller that polls repeatedly (the `dayz-running`
/// watcher in `src-tauri/src/commands/launch.rs`) should keep a [`ProcessWatch`]
/// around instead, so `sysinfo` can diff against the previous snapshot rather
/// than doing a cold enumeration every time.
pub fn dayz_is_running() -> bool {
    let mut system = System::new();
    dayz_is_running_with(&mut system)
}

/// Same check as [`dayz_is_running`], against a caller-owned [`System`] that
/// can be reused across calls.
fn dayz_is_running_with(system: &mut System) -> bool {
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    // Each `processes_by_name` iterator borrows `system`, so it must be
    // consumed before the next one starts.
    GAME_PROCESSES
        .iter()
        .any(|name| system.processes_by_name(OsStr::new(name)).next().is_some())
}

/// A reusable process-table snapshot for repeated [`dayz_is_running`] checks.
///
/// Wraps a [`System`] so a caller that polls this every few seconds doesn't
/// need `sysinfo` as a direct dependency just to keep one around, and so the
/// underlying refresh can diff against the previous snapshot instead of
/// enumerating the whole process table cold on every tick.
pub struct ProcessWatch(System);

impl ProcessWatch {
    pub fn new() -> Self {
        Self(System::new())
    }

    pub fn dayz_is_running(&mut self) -> bool {
        dayz_is_running_with(&mut self.0)
    }
}

impl Default for ProcessWatch {
    fn default() -> Self {
        Self::new()
    }
}

/// How much earlier than a session's own launch a matching process's
/// reported start time may be and still plausibly be *that* session, not a
/// leftover from before it. Absorbs the gap between a `started_at` timestamp
/// (captured right after `spawn_dayz` returns) and the OS recording process
/// creation a moment later — never the other direction, since nothing this
/// launcher starts can predate the launch that started it.
const STALE_GRACE_SECS: i64 = 10;

/// Whether `start_time` (Unix seconds, `0` if the OS couldn't report one)
/// could plausibly belong to a process started by the launch recorded at
/// `launched_at` (Unix seconds), rather than a leftover from an earlier one.
///
/// Split out from [`dayz_running_since`] so the date-arithmetic edge cases
/// (unknown start time, clock-granularity slop) are unit-testable without an
/// OS process table.
fn plausibly_this_session(start_time: u64, launched_at: i64) -> bool {
    let start_time = start_time as i64;
    // `0` means the OS couldn't tell us — see `dayz_running_since` for why
    // that fails open rather than closed.
    start_time == 0 || start_time + STALE_GRACE_SECS >= launched_at
}

/// Whether a DayZ process that could plausibly be *this* session — one whose
/// reported start time isn't clearly older than `launched_at` (Unix seconds,
/// matching `PresenceInfo::started_at`) — exists.
///
/// `dayz_is_running` alone answers "does a process with this name exist
/// anywhere", which a crashed or improperly torn-down session can satisfy
/// long after the player has actually stopped playing — unlike a POSIX
/// zombie, a hung-but-not-fully-exited Windows process stays fully
/// enumerable, under the same name, for as long as it lingers. Discord's
/// presence poll (`src-tauri/src/discord.rs`) read that as "still in game"
/// forever, with nothing to ever correct it — this is the fix: a process
/// this launch could not possibly have produced doesn't count.
///
/// Windows can only report a process's start time by opening a handle to it
/// (`OpenProcess`), and whether BattlEye's protection allows that for its
/// *own* legitimately-running game is untested against a real affected
/// machine. If the OS can't tell us the start time at all (`start_time() ==
/// 0`), this deliberately **fails open** to the plain existence check rather
/// than treating "unknown" as "stale" — a false "still running" (today's
/// behaviour, unchanged) is preferable to a false "not running" that would
/// revert a genuinely live session to idle mid-session.
pub fn dayz_running_since(launched_at: i64) -> bool {
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    GAME_PROCESSES.iter().any(|name| {
        system
            .processes_by_name(OsStr::new(name))
            .any(|p| plausibly_this_session(p.start_time(), launched_at))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real assertion here is that the query works at all — it enumerates
    /// live processes, so what it finds depends on the machine. A panic or a
    /// hang is the failure this guards against.
    #[test]
    fn the_process_query_answers_without_panicking() {
        let _ = dayz_is_running();
    }

    /// The lookup matches a name rather than answering "some process exists".
    ///
    /// Asserting on DayZ itself would be flaky — it depends on whether the
    /// machine running the tests happens to be in a session — so this pins the
    /// negative with a name nothing can plausibly have.
    /// A reused `ProcessWatch` must answer the same as a fresh one on the
    /// second call — the whole point of `ProcessWatch` is that it's safe to
    /// keep polling on the same instance.
    #[test]
    fn a_reused_process_watch_answers_consistently_across_calls() {
        let mut watch = ProcessWatch::new();
        let first = watch.dayz_is_running();
        let second = watch.dayz_is_running();
        assert_eq!(first, second);
    }

    #[test]
    fn a_name_no_process_has_is_not_found() {
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );
        assert!(system
            .processes_by_name(OsStr::new("tetra-no-such-process-8f3a.exe"))
            .next()
            .is_none());
    }

    #[test]
    fn a_process_that_started_after_the_launch_is_this_session() {
        assert!(plausibly_this_session(1_000, 900));
        assert!(plausibly_this_session(1_000, 1_000));
    }

    #[test]
    fn a_process_from_well_before_the_launch_is_stale() {
        assert!(!plausibly_this_session(500, 1_000));
    }

    #[test]
    fn the_grace_window_absorbs_a_small_head_start() {
        assert!(plausibly_this_session(995, 1_000));
        assert!(!plausibly_this_session(989, 1_000));
    }

    #[test]
    fn an_unreported_start_time_fails_open_rather_than_stale() {
        assert!(plausibly_this_session(0, 1_000_000));
    }
}
