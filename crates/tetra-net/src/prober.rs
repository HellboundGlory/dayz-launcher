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

    pub async fn rules(&self, addr: SocketAddr) -> Result<PackedPayload, NetError> {
        let _permit = self
            .permits
            .acquire()
            .await
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))?;
        with_retries(addr, &self.config, || query_rules(addr, self.config.timeout)).await
    }
}