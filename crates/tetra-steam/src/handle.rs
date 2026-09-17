use crate::actor::{
    self, Command, DownloadRow, MutationResult, StaleOutcome, StreamChunk, SubscribedModInfo,
    WorkshopSearchRow,
};
use crate::error::{InitFailure, SteamError};
use crate::source::Filters;
use crate::workshop::ModState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// Freshness-check timeout, queue time included — above the actor's 20s query deadline.
const REFRESH_STALE_BUDGET: std::time::Duration = std::time::Duration::from_secs(25);

/// Verify-pass timeout — same reasoning as `REFRESH_STALE_BUDGET`.
const VERIFY_BUDGET: std::time::Duration = std::time::Duration::from_secs(30);

/// Mods-tab enumeration timeout — above the actor's 60s first-pull deadline.
const ENUM_BUDGET: std::time::Duration = std::time::Duration::from_secs(90);

/// Workshop text-search timeout — above the actor's 20s query deadline, same
/// reasoning as `REFRESH_STALE_BUDGET`.
const SEARCH_BUDGET: std::time::Duration = std::time::Duration::from_secs(25);

/// Workshop item details timeout.
const DETAILS_BUDGET: std::time::Duration = std::time::Duration::from_secs(25);

/// Subscribe/unsubscribe timeout — a single click the user is waiting on.
const MUTATION_BUDGET: std::time::Duration = std::time::Duration::from_secs(30);

/// List requests Steam will answer for one process. Past this it accepts the
/// request and never completes it: measured 96 served then 4 more in a second
/// pass, with the 32 after those all stalling. Not per pass, and it does not
/// refill — see .ai-notes/crates/tetra-steam/src/plan.rs.md.
pub const LIST_REQUEST_BUDGET: usize = 96;

/// How long [`SteamHandle::shutdown`] waits for the actor to acknowledge a
/// shutdown request before giving up and letting exit continue anyway.
const SHUTDOWN_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Handle to the Steam thread.
pub struct SteamHandle {
    tx: Mutex<Sender<Command>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    /// Live connection flag, updated by the actor's Steam connect/disconnect callbacks.
    connected: Arc<AtomicBool>,
    /// List requests issued since this process started.
    lists_issued: AtomicUsize,
}

impl SteamHandle {
    pub fn start() -> Result<SteamHandle, SteamError> {
        let (tx, rx) = channel();
        let (ready_tx, ready_rx) = channel();
        let connected = Arc::new(AtomicBool::new(true));
        let connected_for_actor = Arc::clone(&connected);

        let thread = std::thread::Builder::new()
            .name("tetra-steam".into())
            .spawn(move || actor::run(rx, ready_tx, connected_for_actor))
            .map_err(|e| SteamError::Init(InitFailure::Internal, e.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(SteamHandle {
                tx: Mutex::new(tx),
                thread: Mutex::new(Some(thread)),
                connected,
                lists_issued: AtomicUsize::new(0),
            }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(SteamError::Init(
                InitFailure::Internal,
                "Steam thread died during startup".into(),
            )),
        }
    }

    /// Whether the Steam backend connection is live right now — a cheap atomic read, safe to poll frequently.
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    pub fn shutdown(self) -> Result<(), SteamError> {
        let (ack, done) = channel();
        self.tx
            .lock()
            .map_err(|_| SteamError::Closed)?
            .send(Command::Shutdown(ack))
            .map_err(|_| SteamError::Closed)?;
        if done.recv_timeout(SHUTDOWN_ACK_TIMEOUT).is_err() {
            // Gave up waiting; let the actor keep running rather than block process exit on it.
            return Ok(());
        }
        if let Some(t) = self.thread.lock().map_err(|_| SteamError::Closed)?.take() {
            let _ = t.join();
        }
        Ok(())
    }

    fn dispatch<T>(
        &self,
        make: impl FnOnce(Sender<Result<T, SteamError>>) -> Command,
    ) -> Result<T, SteamError> {
        let (ack, rx) = channel();
        self.tx
            .lock()
            .map_err(|_| SteamError::Closed)?
            .send(make(ack))
            .map_err(|_| SteamError::Closed)?;
        rx.recv().map_err(|_| SteamError::Closed)?
    }

    /// Like [`Self::dispatch`], but gives up waiting rather than sitting queued
    /// behind a slow command indefinitely. Abandoning the wait doesn't cancel it —
    /// see `.ai-notes/crates/tetra-steam/src/handle.rs.md`.
    fn dispatch_within<T>(
        &self,
        timeout: std::time::Duration,
        make: impl FnOnce(Sender<Result<T, SteamError>>) -> Command,
    ) -> Result<T, SteamError> {
        let (ack, rx) = channel();
        self.tx
            .lock()
            .map_err(|_| SteamError::Closed)?
            .send(make(ack))
            .map_err(|_| SteamError::Closed)?;
        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(SteamError::Timeout),
            Err(_) => Err(SteamError::Closed),
        }
    }

    /// Classified state for many workshop items in one round trip, in the caller's order;
    /// an id Steam didn't answer for defaults to `NotSubscribed`.
    pub fn mod_states(&self, ids: &[u64]) -> Result<Vec<(u64, ModState)>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        // Non-Workshop ids are answered locally — Steam reports id 0 as an empty
        // (non-erroring) state, which would otherwise look like "not subscribed".
        let queryable: Vec<u64> = ids
            .iter()
            .copied()
            .filter(|id| ModState::is_workshop_id(*id))
            .collect();

        let pairs = if queryable.is_empty() {
            Vec::new()
        } else {
            self.dispatch(|ack| Command::UGCItemStates(queryable, ack))?
        };

        Ok(ids
            .iter()
            .map(|id| {
                if !ModState::is_workshop_id(*id) {
                    return (*id, ModState::NotOnWorkshop);
                }
                let bits = pairs
                    .iter()
                    .find(|(got, _)| got == id)
                    .map(|(_, bits)| *bits)
                    .unwrap_or(0);
                (*id, ModState::from_bits(bits))
            })
            .collect())
    }

    /// Byte progress for whichever of `ids` Steam is currently transferring; ids with no
    /// active transfer are omitted (an empty result means nothing is downloading).
    pub fn download_progress(&self, ids: &[u64]) -> Result<Vec<DownloadRow>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch(|ack| Command::UGCDownloadInfo(owned, ack))
    }

    /// Subscribe to each item and queue its download. Results are per-id: a
    /// batch can partially succeed.
    pub fn subscribe_all(&self, ids: &[u64]) -> Result<Vec<MutationResult>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch_within(MUTATION_BUDGET, |ack| Command::UGCSubscribe(owned, ack))
    }

    /// Unsubscribe from each item. Steam deletes the content from disk as a
    /// result, and Workshop items are shared between servers — callers must
    /// confirm with the user first.
    pub fn unsubscribe_all(&self, ids: &[u64]) -> Result<Vec<MutationResult>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch_within(MUTATION_BUDGET, |ack| Command::UGCUnsubscribe(owned, ack))
    }

    /// Ask the Workshop which of `ids` is out of date on disk and start a download for
    /// each one, returning the ids it queued. Best-effort — see
    /// `.ai-notes/crates/tetra-steam/src/handle.rs.md` for why this differs from `mod_states`.
    pub fn refresh_stale(&self, ids: &[u64]) -> Result<Vec<u64>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch_within(REFRESH_STALE_BUDGET, |ack| {
            Command::UGCRefreshStale(owned, ack)
        })
    }

    /// The Mods tab's VERIFY: every id answered with its own staleness verdict, queuing a
    /// download for anything stale or missing. Prefer over [`Self::refresh_stale`] whenever
    /// the user sees the result — this reports per-id, not just what got re-queued.
    pub fn verify_mods(&self, ids: &[u64]) -> Result<Vec<StaleOutcome>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch_within(VERIFY_BUDGET, |ack| Command::UGCVerifyMods(owned, ack))
    }

    /// Every subscribed id, without the Workshop round trip `subscribed_mods` pays for.
    pub fn subscribed_ids(&self) -> Result<Vec<u64>, SteamError> {
        self.dispatch(Command::SubscribedIds)
    }

    /// The Mods tab's enumeration: every subscribed Workshop item filtered to DayZ, with
    /// install facts and Workshop metadata. `cache_age_secs` controls whether Steam answers
    /// from its cache (cheap re-open) or 0 to force a live refresh.
    pub fn subscribed_mods(
        &self,
        cache_age_secs: u32,
    ) -> Result<Vec<SubscribedModInfo>, SteamError> {
        self.dispatch_within(ENUM_BUDGET, |ack| Command::SubscribedMods {
            cache_age_secs,
            ack,
        })
    }

    /// The "Search Workshop" tab: a live text-search query against the whole
    /// Workshop (scoped to DayZ), independent of what's subscribed or seen on
    /// any server. Empty query is rejected by the caller, not here.
    pub fn search_workshop(&self, query: &str) -> Result<Vec<WorkshopSearchRow>, SteamError> {
        let owned = query.to_string();
        self.dispatch_within(SEARCH_BUDGET, |ack| Command::SearchWorkshop {
            query: owned,
            ack,
        })
    }

    /// Queue a fresh download of each id, answering with the ones Steam
    /// accepted. The Mods tab's "reinstall" calls this after clearing the item's
    /// folder, so a corrupt copy is replaced rather than stitched.
    pub fn force_download(&self, ids: &[u64]) -> Result<Vec<u64>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch(|ack| Command::UGCDownload(owned, ack))
    }

    /// Get the install folder for a workshop item.
    pub fn mod_folder(&self, workshop_id: u64) -> Result<Option<PathBuf>, SteamError> {
        self.dispatch(|ack| Command::UGCInstallInfo(workshop_id, ack))
            .map(|opt| opt.map(|info| PathBuf::from(info.folder)))
    }

    pub fn new_mock(tx: Sender<Command>) -> Self {
        Self {
            tx: Mutex::new(tx),
            thread: Mutex::new(None),
            connected: Arc::new(AtomicBool::new(true)),
            lists_issued: AtomicUsize::new(0),
        }
    }

    /// Query Workshop item details by id.
    pub fn workshop_details(&self, ids: &[u64]) -> Result<Vec<WorkshopSearchRow>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch_within(DETAILS_BUDGET, |ack| Command::UGCQueryDetails(owned, ack))
    }

    /// Cached workshop details: returns fresh items inside 24h, queries Steam
    /// for missing/stale items, upserts into cache, and falls back to cache on Steam error.
    pub fn workshop_details_cached(
        &self,
        ids: &[u64],
        reader: &tetra_registry::Reader,
        writer: &tetra_registry::Writer,
    ) -> Result<Vec<tetra_registry::rows::WorkshopCacheRow>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        const TTL_SECS: u64 = 86_400;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let valid_ids: Vec<u64> = ids
            .iter()
            .copied()
            .filter(|&id| ModState::is_workshop_id(id))
            .collect();

        if valid_ids.is_empty() {
            return Ok(Vec::new());
        }

        let mut fresh_cache = reader.get_workshop_cache(&valid_ids, TTL_SECS).unwrap_or_default();

        if valid_ids.iter().all(|id| fresh_cache.contains_key(id)) {
            let mut seen = std::collections::HashSet::new();
            let mut out = Vec::with_capacity(valid_ids.len());
            for id in ids {
                if seen.insert(*id) {
                    if let Some(row) = fresh_cache.get(id) {
                        out.push(row.clone());
                    }
                }
            }
            return Ok(out);
        }

        let mut missing: Vec<u64> = valid_ids
            .into_iter()
            .filter(|id| !fresh_cache.contains_key(id))
            .collect();
        missing.sort_unstable();
        missing.dedup();

        match self.workshop_details(&missing) {
            Ok(steam_rows) => {
                let mut new_cache_rows = Vec::with_capacity(steam_rows.len());
                for s in &steam_rows {
                    if let Ok(wid) = s.workshop_id.parse::<u64>() {
                        new_cache_rows.push(tetra_registry::rows::WorkshopCacheRow {
                            workshop_id: wid,
                            title: s.title.clone(),
                            file_size: s.file_size as u64,
                            preview_url: s.preview_url.clone(),
                            time_updated: s.time_updated as u64,
                            cached_at: now,
                        });
                    }
                }
                if !new_cache_rows.is_empty() {
                    let _ = writer.upsert_workshop_cache_blocking(new_cache_rows.clone());
                    for row in new_cache_rows {
                        fresh_cache.insert(row.workshop_id, row);
                    }
                }
                let mut seen = std::collections::HashSet::new();
                let mut out = Vec::new();
                for id in ids {
                    if seen.insert(*id) {
                        if let Some(row) = fresh_cache.get(id) {
                            out.push(row.clone());
                        }
                    }
                }
                Ok(out)
            }
            Err(e) => {
                let fallback = reader.get_workshop_cache(ids, u64::MAX).unwrap_or_default();
                if !fallback.is_empty() {
                    let mut seen = std::collections::HashSet::new();
                    let mut out = Vec::new();
                    for id in ids {
                        if seen.insert(*id) {
                            if let Some(row) = fallback.get(id) {
                                out.push(row.clone());
                            }
                        }
                    }
                    Ok(out)
                } else {
                    Err(e)
                }
            }
        }
    }
}

impl SteamHandle {
    /// List requests still available to this process.
    pub fn lists_remaining(&self) -> usize {
        LIST_REQUEST_BUDGET.saturating_sub(self.lists_issued.load(Ordering::Relaxed))
    }

    /// Request an internet server list; the receiver yields `Rows` batches then one `Done`.
    /// Dropping it asks the actor to abandon the request at its next flush.
    pub fn internet_list_stream(
        &self,
        filters: &Filters,
    ) -> Result<Receiver<StreamChunk>, SteamError> {
        // Past the budget Steam accepts a request and never completes it, so
        // asking costs a full deadline and returns nothing.
        if self.lists_issued.fetch_add(1, Ordering::Relaxed) >= LIST_REQUEST_BUDGET {
            return Err(SteamError::ListBudgetSpent);
        }
        let (tx, rx) = channel();
        let filters = filters.clone();
        self.tx
            .lock()
            .map_err(|_| SteamError::Closed)?
            .send(Command::InternetListStream(filters, tx))
            .map_err(|_| SteamError::Closed)?;
        Ok(rx)
    }
}

pub fn workshop_details_cached(
    handle: &SteamHandle,
    ids: &[u64],
    reader: &tetra_registry::Reader,
    writer: &tetra_registry::Writer,
) -> Result<Vec<tetra_registry::rows::WorkshopCacheRow>, SteamError> {
    handle.workshop_details_cached(ids, reader, writer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tetra_registry::rows::WorkshopCacheRow;
    use tetra_registry::Registry;

    fn now() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }

    #[test]
    fn cache_is_used_inside_24_hours_and_refreshed_after() {
        let registry = Registry::open_in_memory().expect("open registry");
        let reader = registry.reader().expect("reader");
        let writer = registry.writer();

        let current = now();

        let fresh_item = WorkshopCacheRow {
            workshop_id: 100,
            title: "Cached Mod".into(),
            file_size: 12345,
            preview_url: Some("https://example.com/mod.png".into()),
            time_updated: (current - 3600) as u64,
            cached_at: current - 3600,
        };
        writer
            .upsert_workshop_cache_blocking(vec![fresh_item.clone()])
            .expect("upsert fresh");

        let (tx, rx) = std::sync::mpsc::channel();
        let handle = SteamHandle::new_mock(tx);

        let res = handle
            .workshop_details_cached(&[100], &reader, &writer)
            .expect("details cached");
        assert_eq!(res.len(), 1);
        assert_eq!(res[0], fresh_item);
        assert!(rx.try_recv().is_err());

        let stale_item = WorkshopCacheRow {
            workshop_id: 200,
            title: "Old Title".into(),
            file_size: 1000,
            preview_url: None,
            time_updated: (current - 100_000) as u64,
            cached_at: current - 100_000,
        };
        writer
            .upsert_workshop_cache_blocking(vec![stale_item])
            .expect("upsert stale");

        std::thread::spawn(move || {
            if let Ok(Command::UGCQueryDetails(ids, ack)) = rx.recv() {
                assert_eq!(ids, vec![200]);
                let refreshed = WorkshopSearchRow {
                    workshop_id: "200".into(),
                    title: "New Title".into(),
                    preview_url: Some("https://example.com/new.png".into()),
                    description: "desc".into(),
                    tags: vec![],
                    workshop_url: "https://example.com".into(),
                    time_created: (current - 200_000) as u32,
                    time_updated: current as u32,
                    file_size: 99999,
                    num_subscriptions: "10".into(),
                    num_upvotes: 5,
                    num_downvotes: 1,
                    score: 0.9,
                };
                let _ = ack.send(Ok(vec![refreshed]));
            }
        });

        let res = handle
            .workshop_details_cached(&[200], &reader, &writer)
            .expect("details refreshed");
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].workshop_id, 200);
        assert_eq!(res[0].title, "New Title");
        assert_eq!(res[0].file_size, 99999);

        let cached_in_db = reader.get_workshop_cache(&[200], 86_400).expect("get db cache");
        assert_eq!(
            cached_in_db.get(&200).map(|r| r.title.as_str()),
            Some("New Title")
        );
    }

    #[test]
    fn unreachable_steam_returns_cached_rows() {
        let registry = Registry::open_in_memory().expect("open registry");
        let reader = registry.reader().expect("reader");
        let writer = registry.writer();

        let current = now();
        let old_item = WorkshopCacheRow {
            workshop_id: 300,
            title: "Offline Mod".into(),
            file_size: 7777,
            preview_url: None,
            time_updated: (current - 200_000) as u64,
            cached_at: current - 200_000,
        };
        writer
            .upsert_workshop_cache_blocking(vec![old_item.clone()])
            .expect("upsert old");

        let (tx, rx) = std::sync::mpsc::channel();
        drop(rx);
        let handle = SteamHandle::new_mock(tx);

        let res = handle
            .workshop_details_cached(&[300], &reader, &writer)
            .expect("fallback to cached row");
        assert_eq!(res.len(), 1);
        assert_eq!(res[0], old_item);

        let unvisited_id = 999_999;
        let err_res = handle.workshop_details_cached(&[unvisited_id], &reader, &writer);
        assert!(err_res.is_err());
    }
}


