use std::fmt;
use thiserror::Error;

/// Why the Steam client could not be reached at startup. Only
/// [`InitFailure::SteamNotRunning`] and a couple of others resolve by
/// waiting — see [`Self::resolves_by_waiting`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InitFailure {
    /// Nothing answered on the Steam pipe — user hasn't started Steam.
    SteamNotRunning,
    /// Steam answered but is older than the SDK this build links against.
    SteamOutOfDate,
    /// Steam answered and would not start a DayZ session — covers both "still
    /// signing in" (clears itself) and "no DayZ licence" (never clears), which
    /// Steam doesn't distinguish, hence the bounded poll window.
    SteamNotReady,
    /// Our own Steam thread failed to start or died. Not Steam's fault.
    Internal,
    /// Connection to Steam's backend was lost after a successful init. Only
    /// fixable by a fresh `SteamAPI_Init()`, i.e. a restart.
    Disconnected,
    /// Another `steam_init` call is already in flight on this process.
    AlreadyInitialising,
}

impl InitFailure {
    /// Whether waiting and trying again could plausibly succeed on its own.
    pub fn resolves_by_waiting(self) -> bool {
        matches!(
            self,
            InitFailure::SteamNotRunning
                | InitFailure::SteamNotReady
                | InitFailure::AlreadyInitialising
        )
    }

    /// How many automatic re-checks are worth making, or `None` for "keep
    /// checking indefinitely".
    ///
    /// Only meaningful when [`Self::resolves_by_waiting`] holds.
    pub fn auto_retry_limit(self) -> Option<u32> {
        match self {
            // Could take minutes (signing in, Steam Guard) — worth waiting out.
            InitFailure::SteamNotRunning => None,
            // Long enough for Steam startup, short enough a missing licence
            // stops polling and reports the real problem.
            InitFailure::SteamNotReady => Some(15),
            InitFailure::AlreadyInitialising => Some(5),
            InitFailure::SteamOutOfDate | InitFailure::Internal | InitFailure::Disconnected => {
                Some(0)
            }
        }
    }
}

impl fmt::Display for InitFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            InitFailure::SteamNotRunning => "Steam is not running",
            InitFailure::SteamOutOfDate => "the Steam client is out of date",
            InitFailure::SteamNotReady => "Steam is not ready to start DayZ",
            InitFailure::Internal => "the launcher's Steam thread failed to start",
            InitFailure::Disconnected => "the connection to Steam was lost",
            InitFailure::AlreadyInitialising => "a Steam connection attempt is already in progress",
        };
        f.write_str(s)
    }
}

#[derive(Debug, Error)]
pub enum SteamError {
    #[error("{0} ({1})")]
    Init(InitFailure, String),
    #[error("server list request failed: {0}")]
    Request(String),
    #[error("server list request did not complete in time")]
    Timeout,
    /// Steam stops completing list requests after a per-process allowance;
    /// asking anyway just burns a deadline.
    #[error("Steam will not serve more server lists until the launcher restarts")]
    ListBudgetSpent,
    #[error("the Steam thread has shut down")]
    Closed,
}

impl SteamError {
    /// The classified init failure, for errors that are one.
    pub fn init_failure(&self) -> Option<InitFailure> {
        match self {
            SteamError::Init(kind, _) => Some(*kind),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_failures_that_clear_themselves_are_waited_on() {
        let cases: [(InitFailure, bool, Option<u32>); 6] = [
            (InitFailure::SteamNotRunning, true, None),
            (InitFailure::SteamNotReady, true, Some(15)),
            (InitFailure::AlreadyInitialising, true, Some(5)),
            // The user has to act, so the retry timer must not spin forever.
            (InitFailure::SteamOutOfDate, false, Some(0)),
            (InitFailure::Internal, false, Some(0)),
            (InitFailure::Disconnected, false, Some(0)),
        ];
        for (kind, resolves_by_waiting, auto_retry_limit) in cases {
            assert_eq!(kind.resolves_by_waiting(), resolves_by_waiting, "{kind:?}");
            assert_eq!(kind.auto_retry_limit(), auto_retry_limit, "{kind:?}");
        }
    }

    #[test]
    fn init_failure_is_recoverable_from_the_error() {
        let e = SteamError::Init(InitFailure::SteamNotRunning, "no client".into());
        assert_eq!(e.init_failure(), Some(InitFailure::SteamNotRunning));
        assert_eq!(SteamError::Timeout.init_failure(), None);
    }

    #[test]
    fn serialises_as_the_snake_case_the_frontend_matches_on() {
        let json = serde_json::to_string(&InitFailure::SteamNotRunning).unwrap();
        assert_eq!(json, "\"steam_not_running\"");
        let json = serde_json::to_string(&InitFailure::Disconnected).unwrap();
        assert_eq!(json, "\"disconnected\"");
    }
}
