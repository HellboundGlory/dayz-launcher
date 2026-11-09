use crate::query::{query_info_timed, TimedInfo};
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::time::Duration;
use tetra_core::PingKind;

/// DayZ answers A2S on a 50 ms tick, so each reply carries a wait uniform in
/// `0..TICK_MS`.
const TICK_MS: f64 = 50.0;

/// How many replies an estimate is built from, the first one included.
const ESTIMATE_SAMPLES: usize = 3;

/// Pause between samples. Not a multiple of the tick, so samples land on
/// different phases instead of all waiting the same share of one.
const SAMPLE_GAP: Duration = Duration::from_millis(130);

/// A ping to store: never zero, because the registry reads 0 as "no ping".
#[derive(Debug, Clone, Copy)]
pub struct PingReading {
    pub ms: u32,
    pub kind: PingKind,
}

/// One ICMP echo to an address: the round trip, or `None` for no reply, a
/// timeout or any error.
pub trait Pinger: Send + Sync {
    fn ping<'a>(
        &'a self,
        ip: IpAddr,
        timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Option<Duration>> + Send + 'a>>;
}

/// Estimated round trip from A2S reply times.
///
/// The fastest of `n` replies carries `TICK_MS / (n + 1)` of wait on average — it
/// is the minimum of `n` waits uniform in `0..TICK_MS`. Subtracting that share
/// leaves the trip itself. A protected server answers without waiting for the
/// game server's tick, so its samples need no correction.
pub fn estimate_ms(samples: &[Duration], protected: bool) -> u32 {
    assert!(
        !samples.is_empty(),
        "an estimate needs a reply to work from"
    );
    let fastest = samples
        .iter()
        .min()
        .expect("checked non-empty")
        .as_secs_f64()
        * 1000.0;
    let correction = if protected {
        0.0
    } else {
        TICK_MS / (samples.len() as f64 + 1.0)
    };
    (fastest - correction).round().max(1.0) as u32
}

/// Estimate a server's ping from its A2S reply times, `first` being one already
/// measured. A server that answered without a challenge is behind a DDoS
/// protection service that replies on the game server's behalf, so its time is
/// reported uncorrected and no extra queries are spent.
pub async fn estimate_ping(addr: SocketAddr, first: &TimedInfo, timeout: Duration) -> PingReading {
    let mut samples = Vec::with_capacity(ESTIMATE_SAMPLES);
    samples.push(first.reply_time);
    if !first.challenged {
        return PingReading {
            ms: estimate_ms(&samples, true),
            kind: PingKind::Protected,
        };
    }

    // A sample that fails is skipped, not retried: a server that stops
    // answering must not hold the probe.
    for _ in 1..ESTIMATE_SAMPLES {
        tokio::time::sleep(SAMPLE_GAP).await;
        if let Ok(timed) = query_info_timed(addr, timeout).await {
            samples.push(timed.reply_time);
        }
    }

    PingReading {
        ms: estimate_ms(&samples, false),
        kind: PingKind::Estimated,
    }
}

/// Real ICMP echo through `ping-async`: unprivileged datagram sockets on
/// Linux and macOS, `IcmpSendEcho2Ex` on Windows.
#[cfg(feature = "icmp")]
pub struct IcmpPinger;

#[cfg(feature = "icmp")]
impl IcmpPinger {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(feature = "icmp")]
impl Default for IcmpPinger {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "icmp")]
impl Pinger for IcmpPinger {
    fn ping<'a>(
        &'a self,
        ip: IpAddr,
        timeout: Duration,
    ) -> Pin<Box<dyn Future<Output = Option<Duration>> + Send + 'a>> {
        Box::pin(async move {
            use ping_async::{IcmpEchoRequestor, IcmpEchoStatus};
            let requestor = match IcmpEchoRequestor::new(ip, None, None, Some(timeout)) {
                Ok(requestor) => requestor,
                Err(_) => return None,
            };
            let reply = requestor.send().await.ok()?;
            (reply.status() == IcmpEchoStatus::Success).then(|| reply.round_trip_time())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(value: u64) -> Duration {
        Duration::from_millis(value)
    }

    #[test]
    fn an_estimate_expects_the_fastest_reply_to_have_waited_one_share_of_the_tick() {
        let cases = [
            ("one reply", vec![ms(120)], false, 95),
            (
                "three replies, the fastest 90ms",
                vec![ms(100), ms(90), ms(95)],
                false,
                78,
            ),
            ("a reply faster than the correction", vec![ms(10)], false, 1),
            ("a protected reply", vec![ms(30)], true, 30),
        ];
        for (name, samples, protected, expected) in cases {
            assert_eq!(estimate_ms(&samples, protected), expected, "case: {name}");
        }
    }
}
