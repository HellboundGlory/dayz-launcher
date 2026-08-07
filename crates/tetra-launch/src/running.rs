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
/// CPU sampling, no memory accounting, no command lines.
pub fn dayz_is_running() -> bool {
    let mut system = System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    // Each `processes_by_name` iterator borrows `system`, so it must be
    // consumed before the next one starts.
    GAME_PROCESSES
        .iter()
        .any(|name| system.processes_by_name(OsStr::new(name)).next().is_some())
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
