use std::time::Duration;

/// Maximum simultaneous in-flight A2S queries.
///
/// **This is the one tuning constant for transport concurrency.** Measured
/// 2026-07-26 on Windows 11; see `docs/research/transport-concurrency.md`.
/// No ceiling was found within the tested range (64-2048 concurrent
/// loopback queries all succeeded cleanly); this value halves the largest
/// width tried, for headroom against real internet peers loopback cannot
/// exercise. Change it here and nowhere else.
pub const MAX_IN_FLIGHT: usize = 1024;

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
