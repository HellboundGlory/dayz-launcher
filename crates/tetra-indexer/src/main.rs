#![forbid(unsafe_code)]

//! Tetra's server index backend: one host crawls Steam and A2S-probes every
//! address it finds, and every launcher reads the result instead of spending
//! 17 minutes discovering it for itself.

mod api;
mod config;
mod plan;
mod probe;
mod ratelimit;
mod snapshot;
mod state;
mod steam;
mod store;
mod sweep;

use config::Config;
use state::AppState;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use steam::{SteamClient, SteamServer};
use tetra_net::{ProbeConfig, Prober};
use tetra_registry::{Registry, Writer};
use tokio::sync::{mpsc, watch, Mutex};
use tokio::task::JoinSet;

/// Seconds since the epoch, the only clock in the wire format.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// How long shutdown waits for the background loops before giving up on them.
/// A crawl aborts at the next request boundary when this is set, so a
/// SIGTERM during a ~160 s full crawl stops the loop in seconds rather than
/// forcing `abort_all` on it. Everything else just exits on the watch.
#[derive(Clone, Default)]
struct Abort(Arc<AtomicBool>);

impl Abort {
    fn fire(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    fn is_set(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// One request: every populated server.
    Hot,
    /// The whole recursive plan.
    Full,
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cfg = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::FAILURE;
        }
    };
    cfg.log();

    match std::env::args().nth(1).as_deref() {
        None => serve(cfg).await,
        Some("probe") => probe::run(cfg).await,
        Some(other) => {
            tracing::error!("unknown subcommand {other:?}; usage: tetra-indexer [probe]");
            ExitCode::FAILURE
        }
    }
}

async fn serve(cfg: Config) -> ExitCode {
    let registry = match Registry::open(&cfg.db) {
        Ok(registry) => Arc::new(registry),
        Err(e) => {
            tracing::error!(db = %cfg.db.display(), "cannot open the index: {e}");
            return ExitCode::FAILURE;
        }
    };
    let client = match SteamClient::new(cfg.steam_api_key.clone()) {
        Ok(client) => client,
        Err(e) => {
            tracing::error!("cannot build the Steam client: {e}");
            return ExitCode::FAILURE;
        }
    };

    let cfg = Arc::new(cfg);
    let writer = registry.writer();
    let prober = Prober::new(ProbeConfig {
        max_in_flight: cfg.max_in_flight,
        ..ProbeConfig::default()
    });
    let state = Arc::new(AppState::new(Arc::clone(&registry), cfg.rate_limit_per_min));

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let mut loops: JoinSet<()> = JoinSet::new();
    let abort = Abort::default();

    // Crawls share one lock: two of them at once would double the API spend
    // for the same rows, and the hot one is a subset of the full one anyway.
    let crawl_lock = Arc::new(Mutex::new(()));
    for mode in [Mode::Full, Mode::Hot] {
        loops.spawn(crawl_loop(
            mode,
            Arc::clone(&cfg),
            client.clone(),
            writer.clone(),
            Arc::clone(&state),
            Arc::clone(&crawl_lock),
            abort.clone(),
            shutdown_rx.clone(),
        ));
    }
    loops.spawn(info_loop(
        Arc::clone(&cfg),
        prober.clone(),
        Arc::clone(&registry),
        writer.clone(),
        Arc::clone(&state),
        shutdown_rx.clone(),
    ));
    loops.spawn(rules_loop(
        Arc::clone(&cfg),
        prober,
        Arc::clone(&registry),
        writer,
        Arc::clone(&state),
        shutdown_rx.clone(),
    ));
    loops.spawn(snapshot::run(Arc::clone(&state), shutdown_rx.clone()));

    let listener = match tokio::net::TcpListener::bind(cfg.bind).await {
        Ok(listener) => listener,
        Err(e) => {
            tracing::error!(bind = %cfg.bind, "cannot bind: {e}");
            shutdown_tx.send_replace(true);
            return ExitCode::FAILURE;
        }
    };
    tracing::info!(bind = %cfg.bind, "listening");

    let served = axum::serve(
        listener,
        api::router(Arc::clone(&state))
            .into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(signalled())
    .await;
    if let Err(e) = served {
        tracing::error!("server stopped: {e}");
    }

    tracing::info!("shutting down");
    shutdown_tx.send_replace(true);
    abort.fire();
    if tokio::time::timeout(SHUTDOWN_GRACE, async {
        while loops.join_next().await.is_some() {}
    })
    .await
    .is_err()
    {
        tracing::warn!("background loops did not stop in time; aborting them");
        loops.abort_all();
    }
    ExitCode::SUCCESS
}

/// Resolves on the first SIGTERM (how a container is stopped) or SIGINT.
async fn signalled() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = match signal(SignalKind::terminate()) {
            Ok(sig) => sig,
            Err(e) => {
                tracing::warn!("cannot listen for SIGTERM: {e}");
                let _ = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            _ = term.recv() => tracing::info!("SIGTERM"),
            _ = tokio::signal::ctrl_c() => tracing::info!("SIGINT"),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[allow(clippy::too_many_arguments)] // one handle per collaborator: client, writer, state, lock, abort, shutdown
async fn crawl_loop(
    mode: Mode,
    cfg: Arc<Config>,
    client: SteamClient,
    writer: Writer,
    state: Arc<AppState>,
    crawl_lock: Arc<Mutex<()>>,
    abort: Abort,
    mut shutdown: watch::Receiver<bool>,
) {
    let period = match mode {
        Mode::Hot => cfg.hot_interval,
        Mode::Full => cfg.full_interval,
    };
    let mut ticker = tokio::time::interval(period);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = shutdown.changed() => return,
        }
        let permit = crawl_lock.lock().await;
        let aborted = abort.clone();
        crawl(mode, &cfg, &client, &writer, &state, move || {
            aborted.is_set()
        })
        .await;
        drop(permit);
        if abort.is_set() {
            return;
        }
    }
}

async fn crawl(
    mode: Mode,
    cfg: &Config,
    client: &SteamClient,
    writer: &Writer,
    state: &AppState,
    aborted: impl FnMut() -> bool + Send,
) {
    let (roots, budget, cap, label) = match mode {
        // The hot crawl is populated-only, so the same-IP cap can never drop
        // any of it — the rows it would drop are the empty ones.
        Mode::Hot => (vec![plan::hot()], steam::HOT_BUDGET, 0, "hot"),
        Mode::Full => (plan::roots(), steam::FULL_BUDGET, cfg.max_per_ip, "full"),
    };

    let (tx, rx) = mpsc::channel::<Vec<SteamServer>>(8);
    let ingest = tokio::spawn(store::ingest(writer.clone(), cap, rx));
    let stats = steam::crawl(client, roots, cfg.crawl_concurrency, budget, tx, aborted).await;
    let written = ingest.await.unwrap_or_default();

    tracing::info!(
        crawl = label,
        requests = stats.requests,
        rows = stats.rows,
        unique = stats.unique,
        truncated = stats.truncated,
        errors = stats.errors,
        budget_exhausted = stats.budget_exhausted,
        capped = written.capped,
        farm_ips = written.farm_ips,
        unusable = written.unusable,
        stored = written.written,
        secs = stats.elapsed.as_secs_f32(),
        "crawl finished"
    );

    // A crawl that reached nothing must not look like a fresh pull: a client
    // gates on `Health` freshness, and a confidently empty index is worse
    // for it than no index at all.
    if stats.unique == 0 {
        tracing::warn!(
            crawl = label,
            errors = stats.errors,
            "crawl found no addresses; not marking a pull"
        );
        return;
    }

    let clock = match mode {
        Mode::Hot => &state.clocks.hot_pull,
        Mode::Full => &state.clocks.full_pull,
    };
    clock.store(now(), Ordering::Relaxed);
    state.request_rebuild();
}

async fn info_loop(
    cfg: Arc<Config>,
    prober: Prober,
    registry: Arc<Registry>,
    writer: Writer,
    state: Arc<AppState>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut ticker = tokio::time::interval(cfg.info_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = shutdown.changed() => return,
        }
        match sweep::info(&cfg, &prober, &registry, &writer).await {
            Ok(stats) if stats.probed == 0 => {}
            Ok(stats) => {
                tracing::info!(
                    probed = stats.probed,
                    answered = stats.answered,
                    failed = stats.failed,
                    answer_rate = ratio(stats.answered, stats.probed),
                    offline_marks_suppressed = stats.offline_marks_suppressed,
                    secs = stats.elapsed.as_secs_f32(),
                    "info sweep finished"
                );
                state.clocks.info_sweep.store(now(), Ordering::Relaxed);
                state.request_rebuild();
            }
            Err(e) => tracing::warn!(error = %e, "info sweep failed"),
        }
    }
}

async fn rules_loop(
    cfg: Arc<Config>,
    prober: Prober,
    registry: Arc<Registry>,
    writer: Writer,
    state: Arc<AppState>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut ticker = tokio::time::interval(cfg.rules_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = ticker.tick() => {}
            _ = shutdown.changed() => return,
        }
        match sweep::rules(&cfg, &prober, &registry, &writer).await {
            Ok(stats) if stats.probed == 0 => {}
            Ok(stats) => {
                tracing::info!(
                    probed = stats.probed,
                    answered = stats.answered,
                    mods = stats.mods,
                    answer_rate = ratio(stats.answered, stats.probed),
                    secs = stats.elapsed.as_secs_f32(),
                    "rules sweep finished"
                );
                state.clocks.rules_sweep.store(now(), Ordering::Relaxed);
                state.request_rebuild();
            }
            Err(e) => tracing::warn!(error = %e, "rules sweep failed"),
        }
    }
}

fn ratio(part: usize, whole: usize) -> f32 {
    if whole == 0 {
        0.0
    } else {
        part as f32 / whole as f32
    }
}
