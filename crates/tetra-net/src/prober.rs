use crate::config::ProbeConfig;
use crate::error::NetError;
use crate::query::{query_info, query_rules};
use crate::retry::with_retries;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tetra_core::a2s::dayz::PackedPayload;
use tetra_core::a2s::info::ServerInfo;
use tokio::sync::{mpsc, Semaphore};

#[derive(Debug)]
pub struct ProbeOutcome {
    pub addr: SocketAddr,
    pub result: Result<ServerInfo, NetError>,
    pub rtt: Option<Duration>,
}

/// Hard, configuration-independent ceiling on the interactive JOIN/VERIFY
/// path (`Prober::rules_unqueued`) — the one path a player is actually
/// staring at a spinner for, regardless of a user-configured `query_timeout_ms`.
const INTERACTIVE_DEADLINE: Duration = Duration::from_secs(15);

/// Bounded concurrent A2S refresh.
#[derive(Clone)]
pub struct Prober {
    permits: Arc<Semaphore>,
    config: ProbeConfig,
}

impl Prober {
    pub fn new(config: ProbeConfig) -> Self {
        let permits = Arc::new(Semaphore::new(config.max_in_flight.max(1)));
        Self { permits, config }
    }

    pub fn config(&self) -> &ProbeConfig {
        &self.config
    }

    pub fn refresh(&self, addrs: Vec<SocketAddr>) -> mpsc::Receiver<ProbeOutcome> {
        let (tx, rx) = mpsc::channel(64);

        for addr in addrs {
            let permits = Arc::clone(&self.permits);
            let config = self.config.clone();
            let tx = tx.clone();
            tokio::spawn(async move {
                let permit = match permits.acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => return,
                };
                if tx.is_closed() {
                    return;
                }
                let started = Instant::now();
                let result = with_retries(addr, &config, || query_info(addr, config.timeout)).await;
                let rtt = result.is_ok().then(|| started.elapsed());
                drop(permit);
                let _ = tx.send(ProbeOutcome { addr, result, rtt }).await;
            });
        }

        rx
    }

    /// The retry chain for one A2S_RULES query, with no deadline or
    /// concurrency gating of its own — every public method layers one on top.
    async fn rules_via_retries(&self, addr: SocketAddr) -> Result<PackedPayload, NetError> {
        with_retries(addr, &self.config, || {
            query_rules(addr, self.config.timeout)
        })
        .await
    }

    /// One A2S_RULES query, subject to the shared concurrency gate, with no
    /// deadline beyond `with_retries`' own. For a large refresh with its own
    /// deadline to enforce, prefer [`Self::rules_with_deadline`] instead.
    pub async fn rules(&self, addr: SocketAddr) -> Result<PackedPayload, NetError> {
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))?;
        self.rules_via_retries(addr).await
    }

    /// One A2S_RULES query, subject to the shared concurrency gate, bounded
    /// by `deadline` measured from when a permit was actually acquired —
    /// **not** from when this was called, so semaphore queue time is never
    /// mistaken for the server not answering.
    pub async fn rules_with_deadline(
        &self,
        addr: SocketAddr,
        deadline: Duration,
    ) -> Result<PackedPayload, NetError> {
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))?;
        match tokio::time::timeout(deadline, self.rules_via_retries(addr)).await {
            Ok(result) => result,
            Err(_) => Err(NetError::NoResponse {
                addr,
                attempts: self.config.attempts.max(1),
            }),
        }
    }

    /// One A2S_RULES query that does **not** take a permit, bounded by
    /// [`INTERACTIVE_DEADLINE`]. For the interactive path only (the pre-launch
    /// gate issues exactly one) — taking a permit here would stall JOIN behind
    /// whatever bulk refresh is already queued. Never call this in a loop.
    pub async fn rules_unqueued(&self, addr: SocketAddr) -> Result<PackedPayload, NetError> {
        match tokio::time::timeout(INTERACTIVE_DEADLINE, self.rules_via_retries(addr)).await {
            Ok(result) => result,
            Err(_) => Err(NetError::NoResponse {
                addr,
                attempts: self.config.attempts.max(1),
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A config that gives up almost immediately, so no test waits on a real
    /// network timeout.
    fn impatient(max_in_flight: usize) -> ProbeConfig {
        ProbeConfig {
            timeout: Duration::from_millis(20),
            attempts: 1,
            backoff: Duration::from_millis(1),
            max_in_flight,
        }
    }

    /// An address nothing answers on (bound then dropped, so the port closes).
    fn dead_addr() -> SocketAddr {
        let sock = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind");
        sock.local_addr().expect("local addr")
    }

    /// The pre-launch mod gate must not queue behind bulk probing: with every
    /// permit held, `rules` can't start, but `rules_unqueued` still must.
    #[tokio::test]
    async fn an_unqueued_rules_query_runs_with_every_permit_held() {
        let prober = Prober::new(impatient(2));
        let addr = dead_addr();

        let held = Arc::clone(&prober.permits)
            .acquire_many_owned(2)
            .await
            .expect("semaphore open");

        let unqueued = tokio::time::timeout(Duration::from_secs(2), prober.rules_unqueued(addr));
        assert!(
            unqueued.await.is_ok(),
            "rules_unqueued must not wait on a permit"
        );

        // The gated variant must genuinely block, or the assertion above proves nothing.
        let gated = tokio::time::timeout(Duration::from_millis(300), prober.rules(addr));
        assert!(
            gated.await.is_err(),
            "rules must wait for a permit, or the gate is not doing anything"
        );

        drop(held);
        let after = tokio::time::timeout(Duration::from_secs(2), prober.rules(addr));
        assert!(
            after.await.is_ok(),
            "rules should proceed once a permit frees"
        );
    }

    /// The deadline must be measured from when the permit was acquired, not
    /// from the call. Uses a bound-but-silent socket rather than `dead_addr()`
    /// since a closed port fails almost instantly via ICMP, proving nothing.
    #[tokio::test]
    async fn rules_with_deadline_measures_from_the_permit_not_the_call() {
        let prober = Prober::new(impatient(1));
        let silent_server = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind");
        let addr: SocketAddr = silent_server.local_addr().expect("local addr");

        let held = Arc::clone(&prober.permits)
            .acquire_owned()
            .await
            .expect("semaphore open");

        let hold_for = Duration::from_millis(200);
        // Deliberately smaller than hold_for: if the deadline counted permit
        // wait time, the call would give up before the permit ever freed.
        let call_deadline = Duration::from_millis(50);

        let prober2 = prober.clone();
        let started = Instant::now();
        let call =
            tokio::spawn(async move { prober2.rules_with_deadline(addr, call_deadline).await });

        tokio::time::sleep(hold_for).await;
        drop(held);

        let result = call.await.expect("task should not panic");
        let elapsed = started.elapsed();

        assert!(result.is_err(), "a silent peer never answers");
        assert!(
            elapsed >= hold_for,
            "elapsed {elapsed:?} is less than the {hold_for:?} the permit was held for"
        );

        drop(silent_server);
    }

    /// Cloning a `Prober` shares the budget rather than minting a new one.
    #[tokio::test]
    async fn clones_share_one_permit_budget() {
        let prober = Prober::new(impatient(1));
        let clone = prober.clone();

        let held = Arc::clone(&prober.permits)
            .acquire_owned()
            .await
            .expect("semaphore open");
        assert_eq!(
            clone.permits.available_permits(),
            0,
            "a clone must see the original's permit taken"
        );

        drop(held);
        assert_eq!(clone.permits.available_permits(), 1);
    }

    /// A separately constructed `Prober` is a separate budget — the reason the
    /// app must construct exactly one and share it.
    #[tokio::test]
    async fn separate_probers_do_not_share_a_budget() {
        let a = Prober::new(impatient(1));
        let b = Prober::new(impatient(1));

        let _held = Arc::clone(&a.permits)
            .acquire_owned()
            .await
            .expect("semaphore open");
        assert_eq!(a.permits.available_permits(), 0);
        assert_eq!(
            b.permits.available_permits(),
            1,
            "an independently built Prober brings its own full allowance"
        );
    }
}
