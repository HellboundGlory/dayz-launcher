use std::time::Duration;

/// Default max simultaneous in-flight A2S queries; overridden by
/// `AppSettings::max_concurrent_queries` and capped by `MAX_IN_FLIGHT_CEILING`.
/// Kept well under consumer router NAT-table limits — see .ai-notes.
pub const MAX_IN_FLIGHT: usize = 256;

/// Hard bound on `max_concurrent_queries`, however high a hand-edited
/// settings file sets it.
pub const MAX_IN_FLIGHT_CEILING: usize = 2048;

#[derive(Debug, Clone)]
pub struct ProbeConfig {
    /// Applied to each receive, not to the exchange as a whole.
    pub timeout: Duration,
    /// Total attempts, not retries. `1` means try once and give up.
    pub attempts: u32,
    /// Slept between attempts, doubling each time.
    pub backoff: Duration,
    pub max_in_flight: usize,
}

impl Default for ProbeConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(1),
            attempts: 3,
            backoff: Duration::from_millis(250),
            max_in_flight: MAX_IN_FLIGHT,
        }
    }
}
