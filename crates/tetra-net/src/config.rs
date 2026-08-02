use std::time::Duration;

/// Default maximum simultaneous in-flight A2S queries.
///
/// The **default**, no longer the only value: `AppSettings::max_concurrent_queries`
/// overrides it at startup, so this is what a machine with no settings file
/// gets. `MAX_IN_FLIGHT_CEILING` bounds whatever that setting says.
///
/// Was 1024, from a measurement on 2026-07-26 that found no ceiling between 64
/// and 2048 concurrent queries. That measurement ran over **loopback**, and its
/// own note admitted loopback "cannot exercise real internet peers" — loopback
/// being exactly the path with no NAT table, no consumer router and no ISP rate
/// limiting in it. A thousand simultaneous UDP flows is enough to have entries
/// evicted from a home router's NAT table mid-exchange, and a dropped reply is
/// indistinguishable from a server that never answered: the row just reads
/// offline.
///
/// 256 is the compromise — comfortably inside what consumer networking handles,
/// and still far wider than a refresh needs, since a refresh re-probes only the
/// rows on screen.
pub const MAX_IN_FLIGHT: usize = 256;

/// Hard bound on `max_concurrent_queries`, whatever the settings file says.
///
/// The setting has no UI, so the only way to reach it is editing JSON by hand —
/// which is precisely the route by which a value like `100000` arrives and
/// exhausts the process's socket budget.
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
