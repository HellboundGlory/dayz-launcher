//! `tetra-indexer probe`: prove the key, the quota and the network before
//! anyone runs the service against them. Prints to stdout, and exits non-zero
//! when a number is wrong enough that the service would be useless.

use crate::config::Config;
use crate::plan;
use crate::steam::{self, SteamClient, SteamServer};
use std::collections::HashSet;
use std::net::{SocketAddr, SocketAddrV4};
use std::process::ExitCode;
use std::time::Instant;
use tetra_net::{ProbeConfig, Prober};
use tokio::sync::mpsc;

/// Below this, one request isn't returning enough of the list for a recursive
/// crawl to ever finish — a throttled or rejected key, not a small game.
const MIN_ROW_CAP: usize = 1_000;

/// Below this share of sampled addresses answering A2S_INFO, the host's UDP
/// path is broken (or blocked); the index would be a list of names with no
/// live data behind it.
const MIN_A2S_RATE: f64 = 0.20;

/// Addresses sampled for the A2S check.
const SAMPLE: usize = 500;

pub async fn run(cfg: Config) -> ExitCode {
    let client = match SteamClient::new(cfg.steam_api_key.clone()) {
        Ok(client) => client,
        Err(e) => {
            println!("steam client: FAILED ({e})");
            return ExitCode::FAILURE;
        }
    };
    let mut failures: Vec<String> = Vec::new();

    println!("tetra-indexer probe (v{})", env!("CARGO_PKG_VERSION"));

    // 1. What one request actually returns when asked for twice the cap.
    let started = Instant::now();
    let cap_rows = match client
        .server_list(&format!("\\appid\\{}", plan::APP_ID), 20_000)
        .await
    {
        Ok(rows) => rows.len(),
        Err(e) => {
            println!("row cap:      FAILED ({e})");
            println!("\nresult: FAIL — the key or the network refused the first request");
            return ExitCode::FAILURE;
        }
    };
    println!(
        "row cap:      {cap_rows} rows for limit=20000 in {:.1}s",
        started.elapsed().as_secs_f32()
    );
    if cap_rows < MIN_ROW_CAP {
        failures.push(format!("row cap {cap_rows} < {MIN_ROW_CAP}"));
    }

    // 2. The hot request: every populated server, in one call.
    let started = Instant::now();
    match client
        .server_list(&plan::hot().filter(), plan::REQUEST_LIMIT)
        .await
    {
        Ok(rows) => println!(
            "hot request:  {} populated servers in {:.1}s",
            rows.len(),
            started.elapsed().as_secs_f32()
        ),
        Err(e) => {
            println!("hot request:  FAILED ({e})");
            failures.push(format!("hot request failed: {e}"));
        }
    }

    // 3. The whole recursive plan.
    let (tx, mut rx) = mpsc::channel::<Vec<SteamServer>>(8);
    let collector = tokio::spawn(async move {
        let mut addrs: Vec<SocketAddrV4> = Vec::new();
        while let Some(rows) = rx.recv().await {
            addrs.extend(rows.iter().filter_map(|row| row.socket()));
        }
        addrs
    });
    let stats = steam::crawl(
        &client,
        plan::roots(),
        cfg.crawl_concurrency,
        steam::FULL_BUDGET,
        tx,
        || false,
    )
    .await;
    let addrs = collector.await.unwrap_or_default();
    println!(
        "full crawl:   {} requests, {} rows, {} unique addresses in {:.1}s \
         ({} truncated, {} failed{})",
        stats.requests,
        stats.rows,
        stats.unique,
        stats.elapsed.as_secs_f32(),
        stats.truncated,
        stats.errors,
        if stats.budget_exhausted {
            ", request budget exhausted"
        } else {
            ""
        }
    );
    if addrs.is_empty() {
        println!("\nresult: FAIL — the crawl found no usable addresses");
        return ExitCode::FAILURE;
    }

    // 4. Does this host's UDP path actually reach them?
    let sample = sample_of(&addrs, SAMPLE);
    let prober = Prober::new(ProbeConfig {
        max_in_flight: cfg.max_in_flight,
        ..ProbeConfig::default()
    });
    let started = Instant::now();
    let mut rx = prober.refresh(sample.iter().map(|&s| SocketAddr::V4(s)).collect());
    let (mut answered, mut asked) = (0usize, 0usize);
    while let Some(outcome) = rx.recv().await {
        asked += 1;
        if outcome.result.is_ok() {
            answered += 1;
        }
    }
    let rate = if asked > 0 {
        answered as f64 / asked as f64
    } else {
        0.0
    };
    println!(
        "a2s sample:   {answered}/{asked} answered A2S_INFO ({:.0}%) in {:.1}s",
        rate * 100.0,
        started.elapsed().as_secs_f32()
    );
    if rate < MIN_A2S_RATE {
        failures.push(format!(
            "A2S answer rate {:.0}% < {:.0}%",
            rate * 100.0,
            MIN_A2S_RATE * 100.0
        ));
    }

    if failures.is_empty() {
        println!("\nresult: OK");
        ExitCode::SUCCESS
    } else {
        println!("\nresult: FAIL — {}", failures.join("; "));
        ExitCode::FAILURE
    }
}

/// `n` addresses spread across the crawl. Advert farms publish thousands of
/// consecutive ports, so any contiguous slice would sample one operator's
/// network rather than DayZ; this shuffles first, seeded off the clock.
fn sample_of(addrs: &[SocketAddrV4], n: usize) -> Vec<SocketAddrV4> {
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E3779B97F4A7C15)
        | 1;
    let mut pool: Vec<SocketAddrV4> = addrs.to_vec();
    let mut picked: HashSet<SocketAddrV4> = HashSet::new();
    let mut out = Vec::with_capacity(n.min(pool.len()));
    while out.len() < n.min(pool.len()) {
        // xorshift64*, enough randomness for a sample and no new dependency.
        seed ^= seed >> 12;
        seed ^= seed << 25;
        seed ^= seed >> 27;
        let idx = (seed.wrapping_mul(0x2545F4914F6CDD1D) % pool.len() as u64) as usize;
        let candidate = pool[idx];
        if picked.insert(candidate) {
            out.push(candidate);
        } else {
            // Already taken: swap it out so the pool keeps shrinking.
            pool.swap_remove(idx);
            if pool.is_empty() {
                break;
            }
        }
    }
    out
}
