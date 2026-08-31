//! Whether DayZ is running right now, checked against the OS process table
//! rather than inferred from a timer — also covers sessions the launcher
//! didn't start itself.

use std::ffi::OsStr;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

/// The processes that *are* the game: `DayZ_x64.exe` on Windows, `enfMain`
/// under Proton on Linux. Not `DayZ_BE.exe` — that's the BattlEye stub, which
/// exits within seconds of handing off.
const GAME_PROCESSES: &[&str] = &["DayZ_x64.exe", "enfMain"];

/// Whether a DayZ process exists on this machine. Builds a fresh [`System`]
/// each call; a caller polling repeatedly should keep a [`ProcessWatch`]
/// instead so `sysinfo` can diff against the previous snapshot.
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

/// Grace window absorbing the gap between a launch's `started_at` timestamp
/// and the OS recording process creation a moment later.
const STALE_GRACE_SECS: i64 = 10;

/// Whether `start_time` (Unix seconds, `0` if unknown) could plausibly belong
/// to a process started by the launch recorded at `launched_at`, rather than
/// a leftover from an earlier one. Unknown start time fails open (`true`).
fn plausibly_this_session(start_time: u64, launched_at: i64) -> bool {
    let start_time = start_time as i64;
    start_time == 0 || start_time + STALE_GRACE_SECS >= launched_at
}

/// Whether a DayZ process that could plausibly be *this* session (started at
/// or after `launched_at`, Unix seconds) exists — unlike [`dayz_is_running`],
/// which also matches a crashed/leftover process from an earlier session.
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

    /// Just checks the query runs without panicking — result depends on the machine.
    #[test]
    fn the_process_query_answers_without_panicking() {
        let _ = dayz_is_running();
    }

    /// A reused `ProcessWatch` must answer the same as a fresh one.
    #[test]
    fn a_reused_process_watch_answers_consistently_across_calls() {
        let mut watch = ProcessWatch::new();
        let first = watch.dayz_is_running();
        let second = watch.dayz_is_running();
        assert_eq!(first, second);
    }

    /// Pins the negative case with a name nothing can plausibly have — asserting
    /// on DayZ itself would be flaky depending on the test machine's state.
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
