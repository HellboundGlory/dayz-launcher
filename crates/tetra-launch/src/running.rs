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

    #[test]
    fn only_a_process_started_around_the_launch_counts_as_this_session() {
        let cases = [
            // At or after the launch.
            (1_000, 900, true),
            (1_000, 1_000, true),
            // A leftover from an earlier session.
            (500, 1_000, false),
            // The grace window absorbs a start recorded just before the launch.
            (995, 1_000, true),
            (989, 1_000, false),
            // An unreported start time fails open rather than stale.
            (0, 1_000_000, true),
        ];
        for (start_time, launched_at, expected) in cases {
            assert_eq!(
                plausibly_this_session(start_time, launched_at),
                expected,
                "start_time={start_time}, launched_at={launched_at}"
            );
        }
    }
}
