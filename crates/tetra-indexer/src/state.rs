//! Shared state: the pre-built bodies every client is served from, and when
//! each background cycle last finished.

use crate::ratelimit::RateLimiter;
use axum::body::Bytes;
use std::collections::HashSet;
use std::net::SocketAddrV4;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, RwLock};
use tetra_index::{Health, FORMAT_VERSION};
use tetra_registry::Registry;
use tokio::sync::Notify;

/// A response body, compressed once when it was built.
pub struct GzBody {
    pub bytes: Bytes,
    /// Strong validator over the compressed bytes, quoted.
    pub etag: String,
}

/// One generation of pre-built bodies. Requests never serialise anything.
pub struct Bodies {
    pub generated_at: i64,
    /// Monotonic build counter; the snapshot's `cursor` value. A client's
    /// `?since=` lands on the generation it describes only when the counter
    /// is the source of truth, which is why this is not a clock.
    pub generation: i64,
    pub snapshot: GzBody,
    /// Absent on the first generation, and whenever nearly everything
    /// changed and a delta would be no smaller than the snapshot.
    pub delta: Option<GzBody>,
    /// The `since` this generation's delta is valid from.
    pub delta_from: i64,
    /// Addresses in this generation, kept to diff the next one — the registry
    /// has no tombstones, so a disappearance is only visible as an absence.
    pub keys: HashSet<SocketAddrV4>,
    /// Per-address content fingerprints, compared against the next
    /// generation to decide what a delta must carry.
    pub fingerprints: std::collections::HashMap<String, u64>,
    pub servers: usize,
    pub responsive: usize,
    pub with_mods: usize,
    pub populated: usize,
}

#[derive(Default)]
pub struct Clocks {
    pub hot_pull: AtomicI64,
    pub full_pull: AtomicI64,
    pub info_sweep: AtomicI64,
    pub rules_sweep: AtomicI64,
}

/// `0` means "never happened".
fn stamped(clock: &AtomicI64) -> Option<i64> {
    match clock.load(Ordering::Relaxed) {
        0 => None,
        t => Some(t),
    }
}

pub struct AppState {
    pub registry: Arc<Registry>,
    pub limiter: RateLimiter,
    /// Coalesced "a write cycle finished" signal for the snapshot builder.
    pub rebuild: Notify,
    pub clocks: Clocks,
    bodies: RwLock<Option<Arc<Bodies>>>,
}

impl AppState {
    pub fn new(registry: Arc<Registry>, rate_limit_per_min: u32) -> Self {
        Self {
            registry,
            limiter: RateLimiter::new(rate_limit_per_min),
            rebuild: Notify::new(),
            clocks: Clocks::default(),
            bodies: RwLock::new(None),
        }
    }

    pub fn bodies(&self) -> Option<Arc<Bodies>> {
        self.bodies
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn publish(&self, bodies: Arc<Bodies>) {
        *self
            .bodies
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(bodies);
    }

    pub fn request_rebuild(&self) {
        self.rebuild.notify_one();
    }

    pub fn health(&self) -> Health {
        let bodies = self.bodies();
        Health {
            format_version: FORMAT_VERSION,
            version: env!("CARGO_PKG_VERSION").to_string(),
            servers: bodies.as_ref().map_or(0, |b| b.servers),
            responsive: bodies.as_ref().map_or(0, |b| b.responsive),
            with_mods: bodies.as_ref().map_or(0, |b| b.with_mods),
            populated: bodies.as_ref().map_or(0, |b| b.populated),
            last_hot_pull: stamped(&self.clocks.hot_pull),
            last_full_pull: stamped(&self.clocks.full_pull),
            last_info_sweep: stamped(&self.clocks.info_sweep),
            last_rules_sweep: stamped(&self.clocks.rules_sweep),
            snapshot_generated_at: bodies.as_ref().map(|b| b.generated_at),
        }
    }
}
