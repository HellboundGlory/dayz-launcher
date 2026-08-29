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

/// Ceiling on the interactive JOIN/VERIFY path (`Prober::rules_unqueued`),
/// independent of whatever `query_timeout_ms` a settings file carries.
///
/// That setting is user-configurable up to 10 seconds (see
/// `MAX_IN_FLIGHT_CEILING`'s neighbour in `commands::settings::load_at_startup`),
/// which — even with `with_retries`' own now-bounded chain — could still let
/// one JOIN or VERIFY press wait minutes behind a server that answers just
/// enough to keep every attempt running to its own deadline. This is a hard,
/// configuration-independent ceiling on the one path a player is actually
/// staring at a spinner for.
///
/// When this — rather than the wrapped chain — is what ends the call, the
/// specific cause is unknown (an in-flight attempt was cut off mid-flight),
/// so it is reported as the same `NoResponse` an ordinary no-answer probe
/// would be. The more specific "stopped responding part-way through" still
/// surfaces whenever the chain finishes within this window on its own,
/// which it does under anything but a deliberately slow-played attack
/// against a generously-configured `query_timeout_ms`.
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

    /// The retry chain for one A2S_RULES query, with no deadline of its own
    /// and no concurrency gating. Every public method below layers exactly
    /// one of those on top; this is the one place that decides what
    /// `query_rules` is actually called with, so the three public variants
    /// can never quietly diverge on it.
    async fn rules_via_retries(&self, addr: SocketAddr) -> Result<PackedPayload, NetError> {
        with_retries(addr, &self.config, || {
            query_rules(addr, self.config.timeout)
        })
        .await
    }

    /// One A2S_RULES query, subject to the shared concurrency gate, with no
    /// deadline beyond `with_retries`' own.
    ///
    /// Use this for bulk work that is content with `with_retries`' own pace —
    /// for a refresh with thousands of candidates and a deadline of its own
    /// to enforce, prefer [`Self::rules_with_deadline`] instead, so a fair
    /// FIFO semaphore's queue time is never mistaken for the server not
    /// answering.
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
    /// **not** from when this was called.
    ///
    /// `commands::server::probe_rules` used to wrap the *whole* call to
    /// [`Self::rules`] — permit wait included — in its own fixed deadline.
    /// Against a shared, fair FIFO semaphore carrying thousands of queued
    /// candidates at once, most of that time was queue time, and a deadline
    /// that counts queue time expires almost every candidate before it ever
    /// opens a socket. Starting the clock only once the permit is in hand is
    /// what makes the deadline mean "this server didn't answer in time", not
    /// "this task happened to queue behind a few hundred others".
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
    /// [`INTERACTIVE_DEADLINE`] regardless of the configured
    /// `query_timeout_ms`.
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

    /// The bug `rules_with_deadline` exists to fix: a deadline applied to
    /// the whole call — permit wait included — expires almost every
    /// candidate in a large refresh before it ever gets a permit. The
    /// deadline must be measured from when the permit was actually
    /// acquired, not from when the method was called.
    ///
    /// Deliberately not `dead_addr()`: an unbound (closed) port on Linux
    /// answers a connected UDP socket with an ICMP "port unreachable" that
    /// fails the send almost instantly, which would make this probe resolve
    /// in well under either deadline and prove nothing about which one was
    /// actually applied. A socket that is bound and simply never reads its
    /// incoming datagrams behaves like real packet loss instead.
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
        // Deliberately smaller than `hold_for`: if the deadline were
        // measured from the call — wrapping the permit wait too, the way
        // the fixed `RULES_DEADLINE` at the old `probe_rules` call site used
        // to wrap the whole call to `rules` — the call would give up around
        // `call_deadline`, well before the permit ever freed.
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
            "elapsed {elapsed:?} is less than the {hold_for:?} the permit was \
             held for — the call resolved before it could possibly have \
             acquired a permit, so the deadline must have been counting \
             queue time"
        );

        drop(silent_server);
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
