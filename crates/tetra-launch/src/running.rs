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

/// The process that *is* the game.
///
/// Deliberately not `DayZ_BE.exe`. That is the BattlEye launcher stub, which
/// hands off to this one and exits within seconds — the same behaviour that
/// masked the blocking-spawn bug described in [`crate::spawn::spawn_dayz`].
/// Watching the stub would report a session for a moment and then lose it while
/// the player was still in game.
const GAME_PROCESS: &str = "DayZ_x64.exe";

/// Whether a DayZ process exists on this machine.
///
/// Cheap enough to poll every few seconds: the refresh is asked for
/// [`ProcessRefreshKind::nothing`], so it collects names and nothing else — no
/// CPU sampling, no memory accounting, no command lines.
pub fn dayz_is_running() -> bool {
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    // Bound rather than returned directly: the iterator borrows `system`, and
    // as a tail expression it would outlive the local it borrows from.
    let running = system
        .processes_by_name(OsStr::new(GAME_PROCESS))
        .next()
        .is_some();
    running
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
}
