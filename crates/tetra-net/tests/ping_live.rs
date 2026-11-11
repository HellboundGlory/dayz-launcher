#![cfg(feature = "icmp")]

//! Side-by-side comparison of ICMP and estimated pings against real servers.
//!
//! `PING_LIVE_SERVERS` names a text file of `ip:queryport` lines. Ignored by
//! default: it needs live hosts and a machine where ICMP is allowed.

use std::net::SocketAddr;
use std::time::Duration;
use tetra_core::PingKind;
use tetra_net::{estimate_ping, query_info_timed, IcmpPinger, Pinger};

const TIMEOUT: Duration = Duration::from_secs(2);
const MAX_SERVERS: usize = 30;

fn addresses() -> Vec<SocketAddr> {
    let path = std::env::var("PING_LIVE_SERVERS")
        .expect("PING_LIVE_SERVERS should name a file of ip:queryport lines");
    let text = std::fs::read_to_string(&path).expect("read the server list");
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .take(MAX_SERVERS)
        .filter_map(|line| match line.parse::<SocketAddr>() {
            Ok(addr) => Some(addr),
            Err(e) => {
                eprintln!("skipping {line:?}: {e}");
                None
            }
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore]
async fn estimates_stay_close_to_icmp_on_servers_that_answer_both() {
    let pinger = IcmpPinger::new();
    let mut estimated_errors = Vec::new();
    let mut protected_errors = Vec::new();

    println!(
        "{:<24} {:>8} {:>9} {:>10}  error",
        "address", "ICMP ms", "est. ms", "kind"
    );

    for addr in addresses() {
        let icmp = pinger.ping(addr.ip(), TIMEOUT).await;
        let timed = match query_info_timed(addr, TIMEOUT).await {
            Ok(timed) => timed,
            Err(e) => {
                println!("{:<24} {:>8} {:>9} {:>10}  {e}", addr, fmt(icmp), "-", "-");
                continue;
            }
        };
        let reading = estimate_ping(addr, &timed, TIMEOUT).await;
        let error = icmp.map(|rt| {
            let icmp_ms = rt.as_millis() as i64;
            reading.ms as i64 - icmp_ms
        });
        println!(
            "{:<24} {:>8} {:>9} {:>10}  {}",
            addr,
            fmt(icmp),
            reading.ms,
            kind_name(reading.kind),
            error.map_or("-".to_string(), |e| e.to_string())
        );

        if let Some(e) = error {
            match reading.kind {
                PingKind::Estimated => estimated_errors.push(e.unsigned_abs()),
                PingKind::Protected => protected_errors.push(e.unsigned_abs()),
                PingKind::Measured => {}
            }
        }
    }

    if !protected_errors.is_empty() {
        println!(
            "protected servers: {} compared, errors {protected_errors:?}",
            protected_errors.len()
        );
    }
    assert!(
        !estimated_errors.is_empty(),
        "no server answered both ICMP and A2S with a challenge"
    );
    estimated_errors.sort_unstable();
    let median = estimated_errors[estimated_errors.len() / 2];
    println!(
        "estimated servers: {} compared, median absolute error {median} ms",
        estimated_errors.len()
    );
    assert!(
        median <= 25,
        "median absolute error {median} ms is over the 25 ms the estimate allows"
    );
}

fn fmt(rtt: Option<Duration>) -> String {
    rtt.map_or("-".to_string(), |d| d.as_millis().to_string())
}

fn kind_name(kind: PingKind) -> &'static str {
    match kind {
        PingKind::Measured => "measured",
        PingKind::Estimated => "estimated",
        PingKind::Protected => "protected",
    }
}
