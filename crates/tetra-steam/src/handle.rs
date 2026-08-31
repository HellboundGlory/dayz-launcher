use crate::actor::{
    self, Command, DownloadRow, MutationResult, StaleOutcome, StreamChunk, SubscribedModInfo,
};
use crate::error::{InitFailure, SteamError};
use crate::source::Filters;
use crate::workshop::ModState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// Freshness-check timeout, queue time included — above the actor's 20s query deadline.
const REFRESH_STALE_BUDGET: std::time::Duration = std::time::Duration::from_secs(25);

/// Verify-pass timeout — same reasoning as `REFRESH_STALE_BUDGET`.
const VERIFY_BUDGET: std::time::Duration = std::time::Duration::from_secs(30);

/// Mods-tab enumeration timeout — above the actor's 60s first-pull deadline.
const ENUM_BUDGET: std::time::Duration = std::time::Duration::from_secs(90);

/// Subscribe/unsubscribe timeout — a single click the user is waiting on.
const MUTATION_BUDGET: std::time::Duration = std::time::Duration::from_secs(30);

/// How long [`SteamHandle::shutdown`] waits for the actor to acknowledge a
/// shutdown request before giving up and letting exit continue anyway.
const SHUTDOWN_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Handle to the Steam thread.
pub struct SteamHandle {
    tx: Mutex<Sender<Command>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    /// Live connection flag, updated by the actor's Steam connect/disconnect callbacks.
    connected: Arc<AtomicBool>,
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
}

impl SteamHandle {
    /// Request an internet server list; the receiver yields `Rows` batches then one `Done`.
    /// Dropping it asks the actor to abandon the request at its next flush.
    pub fn internet_list_stream(
        &self,
        filters: &Filters,
    ) -> Result<Receiver<StreamChunk>, SteamError> {
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
