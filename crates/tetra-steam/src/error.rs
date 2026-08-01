use std::fmt;
use thiserror::Error;

/// Why the Steam client could not be reached at startup.
///
/// Carried separately from the message text because the launcher *acts* on
/// these differently. Only [`InitFailure::SteamNotRunning`] resolves by
/// waiting — a missing DayZ licence or an out-of-date client will still be
/// missing or out of date in four seconds, so retrying those on a timer is a
/// loop that never terminates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InitFailure {
    /// Nothing answered on the Steam pipe. Overwhelmingly the common case:
    /// the user has not started Steam.
    SteamNotRunning,
    /// Steam answered but is older than the SDK this build links against.
    SteamOutOfDate,
    /// Steam answered and would not start a DayZ session.
    ///
    /// Steam reports this as an undifferentiated generic failure, and it covers
    /// two situations that need opposite handling: a client that is still
    /// signing in (clears within seconds) and an account with no DayZ licence
    /// (never clears). They are indistinguishable from the API, which is why
    /// this kind is polled for a bounded window rather than forever or not at
    /// all.
    SteamNotReady,
    /// Our own Steam thread failed to start or died. Not Steam's fault, and
    /// nothing the user can act on.
    Internal,
    /// The connection to Steam's backend was lost after a successful init.
    ///
    /// Distinct from `SteamNotRunning`: the local Steam client and our
    /// process are both still alive, so there is no dead pipe to reconnect
    /// to — `SteamHandle` is answering local UGC/mod-state queries from a
    /// client whose backend session is gone. Never resolves by waiting: the
    /// only way back is a fresh `SteamAPI_Init()`, which this process cannot
    /// do without restarting (see `steam_init`'s ready-flag short-circuit).
    Disconnected,
}

impl InitFailure {
    /// Whether waiting and trying again could plausibly succeed on its own.
    pub fn resolves_by_waiting(self) -> bool {
        matches!(
            self,
            InitFailure::SteamNotRunning | InitFailure::SteamNotReady
        )
    }

    /// How many automatic re-checks are worth making, or `None` for "keep
    /// checking indefinitely".
    ///
    /// Only meaningful when [`Self::resolves_by_waiting`] holds.
    pub fn auto_retry_limit(self) -> Option<u32> {
        match self {
            // The user is off starting Steam, signing in, or clearing Steam
            // Guard. That can take minutes and there is nothing to gain by
            // giving up on them.
            InitFailure::SteamNotRunning => None,
            // Long enough to cover a Steam client finishing its startup, short
            // enough that a missing DayZ licence stops polling and gets told
            // what is actually wrong.
            InitFailure::SteamNotReady => Some(15),
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
    fn a_booting_steam_client_is_worth_waiting_for() {
        // Steam reports "still starting up" as a generic failure, so this kind
        // has to keep polling — treating it as final made "Start Steam" flip
        // straight to an error the user then had to dismiss by hand.
        assert!(InitFailure::SteamNotRunning.resolves_by_waiting());
        assert!(InitFailure::SteamNotReady.resolves_by_waiting());
    }

    #[test]
    fn failures_the_user_must_act_on_never_poll() {
        for kind in [
            InitFailure::SteamOutOfDate,
            InitFailure::Internal,
            InitFailure::Disconnected,
        ] {
            assert!(
                !kind.resolves_by_waiting(),
                "{kind:?} would make the retry timer spin forever"
            );
        }
    }

    #[test]
    fn only_an_absent_client_is_waited_on_indefinitely() {
        // Every other pollable kind must be bounded: `SteamNotReady` is also
        // what a missing DayZ licence looks like, and that never resolves.
        assert_eq!(InitFailure::SteamNotRunning.auto_retry_limit(), None);
        for kind in [
            InitFailure::SteamNotReady,
            InitFailure::SteamOutOfDate,
            InitFailure::Internal,
            InitFailure::Disconnected,
        ] {
            assert!(
                kind.auto_retry_limit().is_some(),
                "{kind:?} polls forever with no way to stop"
            );
        }
    }

    #[test]
    fn disconnected_never_auto_retries() {
        // Unlike the startup failures, there is no working handle to fall
        // back to on its own — `steam_init` short-circuits once `ready` is
        // set, so polling it again after a live disconnect would just report
        // success from the same dead handle. The only real fix is a restart.
        assert!(!InitFailure::Disconnected.resolves_by_waiting());
        assert_eq!(InitFailure::Disconnected.auto_retry_limit(), Some(0));
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
