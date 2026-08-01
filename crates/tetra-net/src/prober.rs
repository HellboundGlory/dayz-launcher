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

    /// One A2S_RULES query, subject to the shared concurrency gate.
    ///
    /// Use this for bulk work — a refresh issues thousands of these and the
    /// permit is what stops them all opening a socket at once.
    pub async fn rules(&self, addr: SocketAddr) -> Result<PackedPayload, NetError> {
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))?;
        self.rules_unqueued(addr).await
    }

    /// One A2S_RULES query that does **not** take a permit.
    ///
    /// For the interactive path only: the pre-launch mod gate issues exactly one
    /// of these, and one extra socket cannot exhaust anything the semaphore
    /// exists to protect. Taking a permit would make the player wait — the gate
    /// runs on a click, and a refresh in flight can have several thousand
    /// queries already queued on a fair FIFO semaphore, so JOIN would stall
    /// behind bulk work the player is not waiting for.
    ///
    /// Never call this in a loop.
    pub async fn rules_unqueued(&self, addr: SocketAddr) -> Result<PackedPayload, NetError> {
        with_retries(addr, &self.config, || {
            query_rules(addr, self.config.timeout)
        })
        .await
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

    /// An address nothing answers on. The socket is bound and dropped, so the
    /// port is closed — either way the query fails fast, which is all that
    /// matters here: these tests care about *whether a call starts*, not
    /// whether it succeeds.
    fn dead_addr() -> SocketAddr {
        let sock = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind");
        sock.local_addr().expect("local addr")
    }

    /// The pre-launch mod gate must not queue behind bulk probing.
    ///
    /// With every permit held, `rules` cannot start, but `rules_unqueued` — the
    /// call the launch path makes — must still run. Before the probers were
    /// shared this held only by accident, because the launch path owned a
    /// semaphore nothing else touched. Now it is a property of the method.
    #[tokio::test]
    async fn an_unqueued_rules_query_runs_with_every_permit_held() {
        let prober = Prober::new(impatient(2));
        let addr = dead_addr();

        let held = Arc::clone(&prober.permits)
            .acquire_many_owned(2)
            .await
            .expect("semaphore open");

        // Resolves (to a network error) rather than hanging. A permit-blocked
        // call would instead sit until the outer timeout fired.
        let unqueued = tokio::time::timeout(Duration::from_secs(2), prober.rules_unqueued(addr));
        assert!(
            unqueued.await.is_ok(),
            "rules_unqueued must not wait on a permit"
        );

        // ...while the gated variant genuinely is blocked. Without this half,
        // the test above would still pass if the semaphore did nothing at all.
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

    /// Cloning a `Prober` shares the budget rather than minting a new one.
    ///
    /// This is the invariant the refresh path used to violate: it built a fresh
    /// `Prober::new(ProbeConfig::default())` per call, so every concurrent
    /// refresh received its own full `MAX_IN_FLIGHT` allowance.
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
