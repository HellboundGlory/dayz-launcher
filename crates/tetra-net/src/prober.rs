use crate::config::ProbeConfig;
use crate::error::NetError;
use crate::ping::{estimate_ping, PingReading, Pinger};
use crate::query::{query_info_timed, query_rules};
use crate::retry::with_retries;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tetra_core::a2s::dayz::PackedPayload;
use tetra_core::a2s::info::ServerInfo;
use tetra_core::PingKind;
use tokio::sync::{mpsc, OnceCell, Semaphore};

#[derive(Debug)]
pub struct ProbeOutcome {
    pub addr: SocketAddr,
    pub result: Result<ServerInfo, NetError>,
    /// The final-reply time of the attempt that answered, challenge round trip
    /// excluded.
    pub rtt: Option<Duration>,
    /// Where the shown ping came from; `None` when no ping was worked out.
    pub ping: Option<PingReading>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IcmpStatus {
    /// No echo has been attempted yet this session.
    #[default]
    Unchecked,
    Available,
    /// No echo to the loopback address came back, so ICMP is blocked for this user.
    Unavailable,
}

/// Hard, configuration-independent ceiling on the interactive JOIN/VERIFY
/// path (`Prober::rules_unqueued`) — the one path a player is actually
/// staring at a spinner for, regardless of a user-configured `query_timeout_ms`.
const INTERACTIVE_DEADLINE: Duration = Duration::from_secs(15);

/// Echoes allowed in flight at once, separate from the A2S gate so a slow
/// ping never holds up a query.
const ICMP_IN_FLIGHT: usize = 256;

/// Longest wait for one echo. A real ping past this is unplayable anyway, and a
/// host that drops echoes would otherwise cost the full query timeout twice.
const ECHO_TIMEOUT: Duration = Duration::from_millis(600);

/// The ping side of a prober: one pinger, one echo budget and the once-per-session
/// verdict on whether ICMP works here.
struct PingState {
    pinger: Arc<dyn Pinger>,
    permits: Semaphore,
    status: OnceCell<IcmpStatus>,
    timeout: Duration,
    /// Hosts that missed both echoes this session; they go straight to the estimate.
    silent: std::sync::Mutex<std::collections::HashSet<IpAddr>>,
}

impl PingState {
    fn new(pinger: Arc<dyn Pinger>, timeout: Duration) -> Self {
        Self {
            pinger,
            permits: Semaphore::new(ICMP_IN_FLIGHT),
            status: OnceCell::new(),
            timeout: timeout.min(ECHO_TIMEOUT),
            silent: std::sync::Mutex::new(std::collections::HashSet::new()),
        }
    }

    /// Whether ICMP works here, decided once per session by a loopback echo.
    async fn status(&self) -> IcmpStatus {
        *self
            .status
            .get_or_init(|| async {
                match self.echo_until_answered(IpAddr::from([127, 0, 0, 1])).await {
                    Some(_) => IcmpStatus::Available,
                    None => IcmpStatus::Unavailable,
                }
            })
            .await
    }

    /// One host's echo, at most once per [`OnceCell`] so a machine running
    /// several servers is pinged once per refresh.
    async fn echo(&self, cell: &OnceCell<Option<Duration>>, ip: IpAddr) -> Option<Duration> {
        if self.status().await == IcmpStatus::Unavailable {
            return None;
        }
        if self.silent.lock().map(|s| s.contains(&ip)).unwrap_or(false) {
            return None;
        }
        let rtt = *cell.get_or_init(|| self.echo_until_answered(ip)).await;
        if rtt.is_none() {
            if let Ok(mut silent) = self.silent.lock() {
                silent.insert(ip);
            }
        }
        rtt
    }

    /// Up to two echoes, the first reply winning. Each is wrapped in its own
    /// timeout so a pinger that never settles cannot hang a probe.
    async fn echo_until_answered(&self, ip: IpAddr) -> Option<Duration> {
        for _ in 0..2 {
            if let Some(rtt) = self.echo_once(ip).await {
                return Some(rtt);
            }
        }
        None
    }

    async fn echo_once(&self, ip: IpAddr) -> Option<Duration> {
        let _permit = self.permits.acquire().await.ok()?;
        tokio::time::timeout(self.timeout, self.pinger.ping(ip, self.timeout))
            .await
            .unwrap_or_default()
    }
}

/// Bounded concurrent A2S refresh.
#[derive(Clone)]
pub struct Prober {
    permits: Arc<Semaphore>,
    config: ProbeConfig,
    ping: Option<Arc<PingState>>,
}

impl Prober {
    pub fn new(config: ProbeConfig) -> Self {
        let permits = Arc::new(Semaphore::new(config.max_in_flight.max(1)));
        Self {
            permits,
            config,
            ping: None,
        }
    }

    /// Add ICMP pings. Without this a prober measures nothing over ICMP and
    /// leaves `ProbeOutcome.ping` empty.
    pub fn with_pinger(self, pinger: Arc<dyn Pinger>) -> Self {
        let timeout = self.config.timeout;
        Self {
            ping: Some(Arc::new(PingState::new(pinger, timeout))),
            ..self
        }
    }

    pub fn config(&self) -> &ProbeConfig {
        &self.config
    }

    /// The session's verdict on ICMP, or [`IcmpStatus::Unchecked`] before the
    /// first probe asked.
    pub fn icmp_status(&self) -> IcmpStatus {
        self.ping
            .as_ref()
            .and_then(|state| state.status.get().copied())
            .unwrap_or_default()
    }
    pub fn rules_fanout(&self) -> usize {
        self.config.max_in_flight.clamp(1, 1000)
    }

    pub fn refresh(&self, addrs: Vec<SocketAddr>) -> mpsc::Receiver<ProbeOutcome> {
        let (tx, rx) = mpsc::channel(64);

        let permits = Arc::clone(&self.permits);
        let config = self.config.clone();
        let ping = self.ping.as_ref().map(Arc::clone);
        // Spawn a probe only once it has a permit, so a rules query never
        // queues behind every address of a large refresh.
        tokio::spawn(async move {
            // One echo per distinct host per call: ten servers on one machine
            // are pinged once, not ten times.
            let mut host_pings: HashMap<IpAddr, Arc<OnceCell<Option<Duration>>>> = HashMap::new();
            for addr in addrs {
                let host_ping = match &ping {
                    Some(_) => Some(Arc::clone(
                        host_pings
                            .entry(addr.ip())
                            .or_insert_with(|| Arc::new(OnceCell::new())),
                    )),
                    None => None,
                };
                // A dropped receiver also gives up the place in the permit queue.
                let permit = tokio::select! {
                    biased;
                    _ = tx.closed() => return,
                    permit = Arc::clone(&permits).acquire_owned() => match permit {
                        Ok(permit) => permit,
                        Err(_) => return,
                    },
                };
                let tx = tx.clone();
                let config = config.clone();
                let ping = ping.as_ref().map(Arc::clone);
                tokio::spawn(async move {
                    let outcome = probe_info(addr, config, ping, host_ping).await;
                    drop(permit);
                    let _ = tx.send(outcome).await;
                });
            }
        });

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

/// One A2S_INFO probe. The caller holds a permit for its duration.
///
/// The host's echo and the query run side by side: an answered echo is the
/// ping, no answer means the time is estimated from the query's own replies.
async fn probe_info(
    addr: SocketAddr,
    config: ProbeConfig,
    ping: Option<Arc<PingState>>,
    host_ping: Option<Arc<OnceCell<Option<Duration>>>>,
) -> ProbeOutcome {
    let host_echo = async {
        match (&ping, &host_ping) {
            (Some(state), Some(cell)) => state.echo(cell, addr.ip()).await,
            _ => None,
        }
    };

    let query = with_retries(addr, &config, || query_info_timed(addr, config.timeout));

    let (host_rtt, queried) = tokio::join!(host_echo, query);

    let (result, rtt, ping) = match queried {
        // Another game answering on that port is not an answer, so no ping is
        // worked out for it.
        Ok(timed) if !timed.info.is_dayz() => (Err(NetError::NotDayZ { addr }), None, None),
        Ok(timed) => {
            let rtt = timed.reply_time;
            let ping = match host_rtt {
                Some(rtt) => Some(PingReading {
                    ms: rtt.as_millis().clamp(1, u32::MAX as u128) as u32,
                    kind: PingKind::Measured,
                }),
                None => match ping {
                    Some(_) => Some(estimate_ping(addr, &timed, config.timeout).await),
                    None => None,
                },
            };
            (Ok(timed.info), Some(rtt), ping)
        }
        Err(e) => (Err(e), None, None),
    };

    ProbeOutcome {
        addr,
        result,
        rtt,
        ping,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::{challenge_response, info_response};
    use std::net::Ipv4Addr;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::Instant;

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

    /// A config whose read timeout leaves room for a fake server's delays.
    fn patient(max_in_flight: usize) -> ProbeConfig {
        ProbeConfig {
            timeout: Duration::from_millis(500),
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

    /// Windows wakes timers on a ~15.6 ms tick, so each of a fake server's
    /// sleeps can land its reply up to one tick late.
    const SLEEP_SLACK_MS: u32 = if cfg!(windows) { 32 } else { 0 };

    /// Wait until the next `tick` boundary on a clock offset by `offset`.
    fn until_next_tick(elapsed: Duration, offset: Duration, tick: Duration) -> Duration {
        let e = elapsed.as_nanos() as i128;
        let o = offset.as_nanos() as i128;
        let t = tick.as_nanos() as i128;
        let rel = e - o;
        let k = if rel <= 0 { 0 } else { (rel + t - 1) / t };
        Duration::from_nanos((o + k * t - e).max(0) as u64)
    }

    /// A server that demands a challenge (`challenge_delay` later) and then
    /// answers on its next 50 ms tick, 40 ms after it. Counts the datagrams it
    /// received.
    async fn ticked_server(
        bind: IpAddr,
        offset: Duration,
        challenge_delay: Duration,
    ) -> (SocketAddr, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
        let sock = tokio::net::UdpSocket::bind(SocketAddr::from((bind_v4(bind), 0)))
            .await
            .expect("bind fake server");
        let addr = sock.local_addr().expect("local addr");
        let requests = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&requests);
        let handle = tokio::spawn(async move {
            let start = Instant::now();
            let mut buf = [0u8; 64];
            loop {
                let Ok((_, client)) = sock.recv_from(&mut buf).await else {
                    return;
                };
                seen.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(challenge_delay).await;
                if sock.send_to(&challenge_response(), client).await.is_err() {
                    return;
                }
                let Ok((_, client)) = sock.recv_from(&mut buf).await else {
                    return;
                };
                seen.fetch_add(1, Ordering::SeqCst);
                let wait = until_next_tick(start.elapsed(), offset, Duration::from_millis(50));
                tokio::time::sleep(wait + Duration::from_millis(40)).await;
                if sock.send_to(&info_response(), client).await.is_err() {
                    return;
                }
            }
        });
        (addr, requests, handle)
    }

    /// A server that answers each request straight away, `delay` later, never
    /// asking for a challenge. Counts the requests it received.
    async fn direct_server(
        bind: IpAddr,
        delay: Duration,
    ) -> (SocketAddr, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
        let sock = tokio::net::UdpSocket::bind(SocketAddr::from((bind_v4(bind), 0)))
            .await
            .expect("bind fake server");
        let addr = sock.local_addr().expect("local addr");
        let requests = Arc::new(AtomicUsize::new(0));
        let seen = Arc::clone(&requests);
        let handle = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            loop {
                let Ok((_, client)) = sock.recv_from(&mut buf).await else {
                    return;
                };
                seen.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(delay).await;
                if sock.send_to(&info_response(), client).await.is_err() {
                    return;
                }
            }
        });
        (addr, requests, handle)
    }

    fn bind_v4(ip: IpAddr) -> Ipv4Addr {
        match ip {
            IpAddr::V4(v4) => v4,
            IpAddr::V6(_) => panic!("fake servers bind IPv4"),
        }
    }

    fn loopback() -> IpAddr {
        IpAddr::from([127, 0, 0, 1])
    }

    /// The address the fake servers live on — distinct from the loopback check.
    fn host() -> IpAddr {
        IpAddr::from([127, 0, 0, 2])
    }

    /// Answers the loopback check when told to, and gives the same answer for
    /// every other address. Records each address it was asked about.
    struct FixedPinger {
        here: Option<Duration>,
        elsewhere: Option<Duration>,
        calls: Mutex<Vec<IpAddr>>,
    }

    impl FixedPinger {
        fn new(here: Option<Duration>, elsewhere: Option<Duration>) -> Self {
            Self {
                here,
                elsewhere,
                calls: Mutex::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<IpAddr> {
            self.calls.lock().expect("calls lock").clone()
        }
    }

    impl Pinger for FixedPinger {
        fn ping<'a>(
            &'a self,
            ip: IpAddr,
            _timeout: Duration,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<Duration>> + Send + 'a>>
        {
            self.calls.lock().expect("calls lock").push(ip);
            let reply = if ip == loopback() {
                self.here
            } else {
                self.elsewhere
            };
            Box::pin(async move { reply })
        }
    }

    /// Answers the loopback check and then returns `None` once per address
    /// before answering, so the second echo is the one that counts.
    struct SecondTryPinger {
        seen: Mutex<std::collections::HashSet<IpAddr>>,
    }

    impl Pinger for SecondTryPinger {
        fn ping<'a>(
            &'a self,
            ip: IpAddr,
            _timeout: Duration,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<Duration>> + Send + 'a>>
        {
            if ip == loopback() {
                return Box::pin(async { Some(Duration::from_millis(1)) });
            }
            let first = self.seen.lock().expect("seen lock").insert(ip);
            Box::pin(async move {
                if first {
                    None
                } else {
                    Some(Duration::from_millis(25))
                }
            })
        }
    }

    /// Answers the loopback check at once and parks every other echo until
    /// released, recording how many ran at once.
    struct ParkingPinger {
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
        released: tokio::sync::watch::Receiver<bool>,
    }

    impl Pinger for ParkingPinger {
        fn ping<'a>(
            &'a self,
            ip: IpAddr,
            _timeout: Duration,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<Duration>> + Send + 'a>>
        {
            if ip == loopback() {
                return Box::pin(async { Some(Duration::from_millis(1)) });
            }
            let active = Arc::clone(&self.active);
            let max_active = Arc::clone(&self.max_active);
            let mut released = self.released.clone();
            let now = active.fetch_add(1, Ordering::SeqCst) + 1;
            max_active.fetch_max(now, Ordering::SeqCst);
            Box::pin(async move {
                let _ = released.wait_for(|done| *done).await;
                active.fetch_sub(1, Ordering::SeqCst);
                Some(Duration::from_millis(2))
            })
        }
    }

    /// A ticked fake server answers after a known extra 40 ms, so an uncorrected
    /// estimate is about that regardless of which tick phase the reply landed in.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_estimate_lands_near_the_real_delay_for_every_tick_offset() {
        let cases = [
            ("tick at t0", Duration::ZERO),
            ("tick at t0 + 17ms", Duration::from_millis(17)),
            ("tick at t0 + 33ms", Duration::from_millis(33)),
        ];
        for (name, offset) in cases {
            let (addr, requests, server) =
                ticked_server(host(), offset, Duration::from_millis(1)).await;
            let pinger = FixedPinger::new(Some(Duration::from_millis(1)), None);
            let prober = Prober::new(patient(4)).with_pinger(Arc::new(pinger));

            let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
            assert!(outcome.result.is_ok(), "case: {name}");
            let reading = outcome.ping.expect("a ping");
            assert_eq!(reading.kind, PingKind::Estimated, "case: {name}");
            assert!(
                (20..=60 + SLEEP_SLACK_MS).contains(&reading.ms),
                "case: {name}: estimated {}ms, expected 40 +/- 20",
                reading.ms
            );
            assert!(
                requests.load(Ordering::SeqCst) > 1,
                "case: {name}: an estimate needs more than one exchange"
            );

            server.abort();
        }
    }

    /// The challenge round trip is the server's own delay, so a slow challenge
    /// must not inflate the estimate.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_slow_challenge_does_not_inflate_the_estimate() {
        let (addr, _, server) =
            ticked_server(host(), Duration::ZERO, Duration::from_millis(300)).await;
        let prober = Prober::new(patient(4)).with_pinger(Arc::new(FixedPinger::new(
            Some(Duration::from_millis(1)),
            None,
        )));

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        assert!(outcome.result.is_ok());
        let reading = outcome.ping.expect("a ping");
        assert_eq!(reading.kind, PingKind::Estimated);
        assert!(
            (20..=60 + SLEEP_SLACK_MS).contains(&reading.ms),
            "estimated {}ms, expected 40 +/- 20 and not near the 300ms challenge wait",
            reading.ms
        );

        server.abort();
    }

    /// A server that answers one full exchange and then goes silent must still
    /// let the probe finish, with the one sample it gave.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_estimate_finishes_when_the_server_stops_answering() {
        let sock = tokio::net::UdpSocket::bind(SocketAddr::from((bind_v4(host()), 0)))
            .await
            .expect("bind fake server");
        let addr = sock.local_addr().expect("local addr");
        let server = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            let Ok((_, client)) = sock.recv_from(&mut buf).await else {
                return;
            };
            let _ = sock.send_to(&challenge_response(), client).await;
            let Ok((_, client)) = sock.recv_from(&mut buf).await else {
                return;
            };
            let _ = sock.send_to(&info_response(), client).await;
            while sock.recv_from(&mut buf).await.is_ok() {}
        });
        let prober = Prober::new(impatient(4)).with_pinger(Arc::new(FixedPinger::new(
            Some(Duration::from_millis(1)),
            None,
        )));

        let outcome = tokio::time::timeout(Duration::from_secs(3), async {
            prober.refresh(vec![addr]).recv().await
        })
        .await
        .expect("the probe finishes")
        .expect("an outcome");
        assert_eq!(outcome.ping.expect("a ping").kind, PingKind::Estimated);

        server.abort();
    }

    /// A reply that skips the challenge comes from a protection service, whose
    /// time needs no tick correction and no further samples.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_unchallenged_reply_reads_as_protected_and_is_not_corrected() {
        let (addr, requests, server) = direct_server(host(), Duration::from_millis(60)).await;
        let prober = Prober::new(patient(4)).with_pinger(Arc::new(FixedPinger::new(
            Some(Duration::from_millis(1)),
            None,
        )));

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        assert!(outcome.result.is_ok());
        let reading = outcome.ping.expect("a ping");
        assert_eq!(reading.kind, PingKind::Protected);
        assert!(
            (40..=80 + SLEEP_SLACK_MS).contains(&reading.ms),
            "protected estimate {}ms, expected 60 +/- 20",
            reading.ms
        );
        assert_eq!(
            requests.load(Ordering::SeqCst),
            1,
            "a protected server must not be sampled again"
        );

        server.abort();
    }

    /// Another game answering A2S on that port is not an answer, and its reply
    /// yields no ping even when the echo came back.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_server_of_another_game_is_not_an_answer() {
        let mut reply = vec![0xff, 0xff, 0xff, 0xff, 0x49, 17];
        for field in ["Arma Server", "altis", "Arma3", "Arma 3"] {
            reply.extend_from_slice(field.as_bytes());
            reply.push(0);
        }
        reply.extend_from_slice(&0u16.to_le_bytes());
        reply.extend_from_slice(&[0, 60, 0, b'd', b'l', 0, 1]);
        reply.extend_from_slice(b"1.0\0");
        reply.push(0x01);
        reply.extend_from_slice(&107_410u64.to_le_bytes());

        let sock = tokio::net::UdpSocket::bind(SocketAddr::from((bind_v4(host()), 0)))
            .await
            .expect("bind fake server");
        let addr = sock.local_addr().expect("local addr");
        let server = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            loop {
                let Ok((_, client)) = sock.recv_from(&mut buf).await else {
                    return;
                };
                if sock.send_to(&reply, client).await.is_err() {
                    return;
                }
            }
        });
        let prober = Prober::new(patient(4)).with_pinger(Arc::new(FixedPinger::new(
            Some(Duration::from_millis(1)),
            Some(Duration::from_millis(30)),
        )));

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        assert!(
            matches!(outcome.result, Err(NetError::NotDayZ { .. })),
            "an Arma 3 reply is not an answer: {:?}",
            outcome.result
        );
        assert!(
            outcome.ping.is_none(),
            "no ping is worked out from another game's reply"
        );

        server.abort();
    }

    /// An answered echo is the ping, with no estimate queries behind it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_answered_echo_is_the_ping_and_needs_no_extra_queries() {
        let (addr, requests, server) =
            ticked_server(host(), Duration::ZERO, Duration::from_millis(1)).await;
        let prober = Prober::new(patient(4)).with_pinger(Arc::new(FixedPinger::new(
            Some(Duration::from_millis(1)),
            Some(Duration::from_millis(30)),
        )));

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        assert!(outcome.result.is_ok());
        let reading = outcome.ping.expect("a ping");
        assert_eq!(reading.kind, PingKind::Measured);
        assert_eq!(reading.ms, 30);
        assert_eq!(
            requests.load(Ordering::SeqCst),
            2,
            "one exchange: a request and its challenged reply"
        );

        server.abort();
    }

    /// An echo that misses first is retried, and the second answer still counts.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_missed_echo_is_retried_once() {
        let (addr, _, server) =
            ticked_server(host(), Duration::ZERO, Duration::from_millis(1)).await;
        let prober = Prober::new(patient(4)).with_pinger(Arc::new(SecondTryPinger {
            seen: Mutex::new(std::collections::HashSet::new()),
        }));

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        let reading = outcome.ping.expect("a ping");
        assert_eq!(reading.kind, PingKind::Measured);
        assert_eq!(reading.ms, 25);

        server.abort();
    }

    /// Misses the loopback check's first echo only; every host answers.
    struct ShyLoopbackPinger {
        loopback_tries: AtomicUsize,
    }

    impl Pinger for ShyLoopbackPinger {
        fn ping<'a>(
            &'a self,
            ip: IpAddr,
            _timeout: Duration,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<Duration>> + Send + 'a>>
        {
            let missed =
                ip == loopback() && self.loopback_tries.fetch_add(1, Ordering::SeqCst) == 0;
            Box::pin(async move { (!missed).then_some(Duration::from_millis(30)) })
        }
    }

    /// One lost loopback echo must not turn ICMP off for the whole session.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_loopback_check_tries_twice() {
        let (addr, _, server) =
            ticked_server(host(), Duration::ZERO, Duration::from_millis(1)).await;
        let prober = Prober::new(patient(4)).with_pinger(Arc::new(ShyLoopbackPinger {
            loopback_tries: AtomicUsize::new(0),
        }));

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        assert_eq!(outcome.ping.expect("a ping").kind, PingKind::Measured);

        server.abort();
    }

    /// A host that missed both echoes is not pinged again on later refreshes,
    /// so it costs the echo wait once per session.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_host_that_never_answers_pings_is_not_pinged_again() {
        let (addr, _, server) =
            ticked_server(host(), Duration::ZERO, Duration::from_millis(1)).await;
        let pinger = Arc::new(FixedPinger::new(Some(Duration::from_millis(1)), None));
        let prober = Prober::new(patient(4)).with_pinger(pinger.clone());

        prober
            .refresh(vec![addr])
            .recv()
            .await
            .expect("first outcome");
        let first = pinger.calls().iter().filter(|ip| **ip == host()).count();
        let again = prober
            .refresh(vec![addr])
            .recv()
            .await
            .expect("second outcome");
        let second = pinger.calls().iter().filter(|ip| **ip == host()).count();

        assert_eq!(first, 2, "two echoes the first time");
        assert_eq!(second, first, "no echo the second time");
        assert_eq!(again.ping.expect("a ping").kind, PingKind::Estimated);

        server.abort();
    }

    /// Blocked ICMP is one verdict per session: no host is pinged, and the
    /// ping is an estimate.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn blocked_icmp_leaves_an_estimate_and_stops_pinging_hosts() {
        let (addr, _, server) =
            ticked_server(host(), Duration::ZERO, Duration::from_millis(1)).await;
        let pinger = Arc::new(FixedPinger::new(None, Some(Duration::from_millis(500))));
        let prober = Prober::new(patient(4)).with_pinger(Arc::clone(&pinger) as Arc<dyn Pinger>);
        let clone = prober.clone();

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        assert_eq!(prober.icmp_status(), IcmpStatus::Unavailable);
        assert_eq!(
            clone.icmp_status(),
            IcmpStatus::Unavailable,
            "the verdict is the session's, shared through a clone"
        );
        assert_eq!(
            pinger.calls(),
            vec![loopback(), loopback()],
            "only the loopback check's two echoes should reach the pinger"
        );
        assert_eq!(outcome.ping.expect("a ping").kind, PingKind::Estimated);

        server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_answered_loopback_check_makes_icmp_available() {
        let (addr, _, server) = direct_server(host(), Duration::from_millis(10)).await;
        let prober = Prober::new(patient(4)).with_pinger(Arc::new(FixedPinger::new(
            Some(Duration::from_millis(1)),
            None,
        )));

        let _ = prober.refresh(vec![addr]).recv().await.expect("an outcome");
        assert_eq!(prober.icmp_status(), IcmpStatus::Available);

        server.abort();
    }

    /// Several servers on one machine cost one ping, not one each.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn servers_sharing_a_host_share_one_echo() {
        let (a, _, a_server) = direct_server(host(), Duration::from_millis(5)).await;
        let (b, _, b_server) = direct_server(host(), Duration::from_millis(5)).await;
        let pinger = Arc::new(FixedPinger::new(
            Some(Duration::from_millis(1)),
            Some(Duration::from_millis(12)),
        ));
        let prober = Prober::new(patient(4)).with_pinger(Arc::clone(&pinger) as Arc<dyn Pinger>);

        let mut rx = prober.refresh(vec![a, b]);
        while rx.recv().await.is_some() {}

        let host_pings = pinger
            .calls()
            .into_iter()
            .filter(|ip| *ip == host())
            .count();
        assert_eq!(
            host_pings, 1,
            "two servers on 127.0.0.1 should share a single echo"
        );

        a_server.abort();
        b_server.abort();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn no_more_than_256_echoes_run_at_once() {
        let (release, released) = tokio::sync::watch::channel(false);
        let pinger = Arc::new(ParkingPinger {
            active: Arc::new(AtomicUsize::new(0)),
            max_active: Arc::new(AtomicUsize::new(0)),
            released,
        });
        let prober = Prober::new(ProbeConfig {
            timeout: Duration::from_secs(5),
            attempts: 1,
            backoff: Duration::from_millis(1),
            max_in_flight: 400,
        })
        .with_pinger(Arc::clone(&pinger) as Arc<dyn Pinger>);

        // One host each, so every address really needs its own echo.
        let addrs: Vec<SocketAddr> = (0..300u16)
            .map(|i| {
                let ip = Ipv4Addr::new(127, 0, 1 + (i / 250) as u8, (i % 250) as u8 + 1);
                SocketAddr::from((ip, i + 1))
            })
            .collect();
        let mut rx = prober.refresh(addrs);

        // Let the loopback check settle and echoes pile up on the gate.
        let mut settled = 0;
        for _ in 0..200 {
            tokio::time::sleep(Duration::from_millis(5)).await;
            settled = pinger.active.load(Ordering::SeqCst);
            if settled >= ICMP_IN_FLIGHT {
                break;
            }
        }
        assert_eq!(settled, ICMP_IN_FLIGHT, "the screen should fill to the cap");
        tokio::time::sleep(Duration::from_millis(50)).await;
        let peak = pinger.max_active.load(Ordering::SeqCst);
        assert!(peak <= ICMP_IN_FLIGHT, "{peak} echoes ran at once");

        let _ = release.send(true);
        let mut outcomes = 0;
        while rx.recv().await.is_some() {
            outcomes += 1;
        }
        assert_eq!(outcomes, 300, "every address gives one outcome");
    }

    /// The pre-launch mod gate must not queue behind bulk probing: with every
    /// permit held, a bulk rules query can't start, but `rules_unqueued` still must.
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
        let gated = tokio::time::timeout(
            Duration::from_millis(300),
            prober.rules_with_deadline(addr, Duration::from_secs(1)),
        );
        assert!(
            gated.await.is_err(),
            "a gated rules query must wait for a permit, or the gate is not doing anything"
        );

        drop(held);
        let after = tokio::time::timeout(
            Duration::from_secs(2),
            prober.rules_with_deadline(addr, Duration::from_secs(1)),
        );
        assert!(
            after.await.is_ok(),
            "a gated rules query should proceed once a permit frees"
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
        // The deadline is shorter than the wait, so a call timed from its own
        // start would already have given up by now.
        assert!(
            !call.is_finished(),
            "the call ended while it was still waiting for a permit, so the deadline counted queue time"
        );
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

    /// The reported rtt must time the attempt that answered, not the whole
    /// retry chain — otherwise the backoff sleep inflates the ping.
    #[tokio::test]
    async fn a_retried_probe_reports_the_answering_attempts_rtt() {
        let server = tokio::net::UdpSocket::bind("127.0.0.1:0")
            .await
            .expect("bind fake server");
        let addr = server.local_addr().expect("local addr");

        let responder = tokio::spawn(async move {
            let mut buf = [0u8; 64];
            server.recv_from(&mut buf).await.expect("first request");
            let (_, client) = server.recv_from(&mut buf).await.expect("retry");
            let _ = server.send_to(&info_response(), client).await;
        });

        let backoff = Duration::from_millis(200);
        let prober = Prober::new(ProbeConfig {
            timeout: Duration::from_millis(20),
            attempts: 3,
            backoff,
            max_in_flight: 1,
        });

        let outcome = prober.refresh(vec![addr]).recv().await.expect("an outcome");

        assert!(outcome.result.is_ok(), "the responder answered the retry");
        let rtt = outcome.rtt.expect("a successful probe carries an rtt");
        assert!(
            rtt < backoff,
            "rtt {rtt:?} must not include the {backoff:?} backoff sleep"
        );

        responder.abort();
    }

    /// A rules query asked for mid-refresh must reach the permit queue ahead of
    /// the refresh's remaining addresses, not behind all of them.
    #[tokio::test]
    async fn a_rules_query_does_not_queue_behind_a_large_refresh() {
        let prober = Prober::new(impatient(1));
        let held = Arc::clone(&prober.permits)
            .acquire_owned()
            .await
            .expect("semaphore open");

        let mut rx = prober.refresh((0..20).map(|_| dead_addr()).collect());

        // Let the refresh side park on the permit before the query queues behind it.
        for _ in 0..4 {
            tokio::task::yield_now().await;
        }

        let rules_prober = prober.clone();
        let mut rules = tokio::spawn(async move {
            rules_prober
                .rules_with_deadline(dead_addr(), Duration::from_secs(1))
                .await
        });
        tokio::task::yield_now().await;

        drop(held);

        let mut received = 0usize;
        let rules_result = loop {
            tokio::select! {
                biased;
                done = &mut rules => break done.expect("the rules task should not panic"),
                outcome = rx.recv() => match outcome {
                    Some(_) => received += 1,
                    None => break rules.await.expect("the rules task should not panic"),
                },
            }
        };

        assert!(
            rules_result.is_err(),
            "a dead address cannot answer a rules query"
        );

        // `len()` counts outcomes that arrived but have not been read yet.
        let arrived = received + rx.len();
        assert!(
            arrived < 3,
            "{arrived} refresh outcomes beat the rules query to the permit"
        );

        while rx.recv().await.is_some() {
            received += 1;
        }
        assert_eq!(
            received, 20,
            "one outcome per address, then the channel closes"
        );
    }
}
