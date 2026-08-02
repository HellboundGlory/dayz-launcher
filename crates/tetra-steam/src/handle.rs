use crate::actor::{self, Command, DownloadRow, MutationResult, StreamChunk};
use crate::error::{InitFailure, SteamError};
use crate::rows::GameServerRow;
use crate::source::{Filters, ServerListSource};
use crate::workshop::ModState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

/// How long a freshness check may take, queue time included.
///
/// Comfortably above the actor's own 20-second query deadline, so this only
/// fires when the command is stuck *behind* something — a discovery holding the
/// Steam thread — rather than cutting short a query that is genuinely working.
const REFRESH_STALE_BUDGET: std::time::Duration = std::time::Duration::from_secs(25);

/// Handle to the Steam thread.
pub struct SteamHandle {
    tx: Mutex<Sender<Command>>,
    thread: Mutex<Option<JoinHandle<()>>>,
    /// Live, not one-shot: flipped by `SteamServersDisconnected`/
    /// `SteamServersConnected` callbacks registered in the actor, so callers
    /// can tell a lost backend connection apart from "never checked since
    /// startup". Local UGC/mod-state calls keep answering from the client's
    /// cache even while this is false — see `InitFailure::Disconnected`.
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

    /// Whether the Steam backend connection is live right now.
    ///
    /// A cheap atomic load — no round trip through the actor thread, so this
    /// is safe to poll frequently.
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
        let _ = done.recv();
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

    /// Like [`Self::dispatch`], but gives up waiting.
    ///
    /// The actor services one command at a time and a server-list request can
    /// hold it for `REQUEST_DEADLINE` — five minutes — with everything else
    /// queued behind it. That is tolerable for work nobody is watching, and not
    /// for work behind a button: a discovery is still running for the first
    /// half-minute after the launcher opens, which is exactly when someone
    /// clicks a favourite and joins.
    ///
    /// Abandoning the wait does not cancel the command. It runs when the actor
    /// reaches it and answers a receiver that has been dropped, which `ack.send`
    /// already tolerates.
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

    /// Whether DayZ can be launched against this mod as-is.
    ///
    /// Delegates to [`ModState`] rather than testing bits inline, so the launch
    /// gate and the details panel answer this question with the same rule. The
    /// previous `(state & 5) == 5` differed twice over: it accepted an item
    /// carrying `NEEDS_UPDATE` (launching against stale content — spec §5.2's
    /// "case that breaks other launchers") and rejected content that is present
    /// on disk but not subscribed.
    pub fn is_installed(&self, workshop_id: u64) -> Result<bool, SteamError> {
        Ok(self.mod_state(workshop_id)?.is_ready())
    }

    /// Classified state for one workshop item.
    pub fn mod_state(&self, workshop_id: u64) -> Result<ModState, SteamError> {
        let bits = self.dispatch(|ack| Command::UGCItemState(workshop_id, ack))?;
        Ok(ModState::from_bits(bits))
    }

    /// Classified state for many workshop items, in one round trip.
    ///
    /// Returned in the caller's order, with any id Steam did not answer for
    /// defaulting to `NotSubscribed` — matching is by id, never by index.
    pub fn mod_states(&self, ids: &[u64]) -> Result<Vec<(u64, ModState)>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        // Non-Workshop ids are answered locally. Asking Steam about id 0 does
        // not error — it reports an empty state, which would render as "not
        // subscribed" and invite the user to subscribe to something that does
        // not exist.
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

    /// Byte progress for whichever of `ids` Steam is currently transferring.
    ///
    /// Ids with no active transfer are omitted, so an empty result means
    /// nothing is downloading — not that the call failed.
    pub fn download_progress(&self, ids: &[u64]) -> Result<Vec<DownloadRow>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch(|ack| Command::UGCDownloadInfo(owned, ack))
    }

    /// Subscribe to each item and queue its download.
    ///
    /// Results are per-id: a batch can partially succeed.
    pub fn subscribe_all(&self, ids: &[u64]) -> Result<Vec<MutationResult>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch(|ack| Command::UGCSubscribe(owned, ack))
    }

    /// Unsubscribe from each item.
    ///
    /// Steam deletes the content from disk as a result, and Workshop items are
    /// shared between servers — callers must confirm with the user first.
    pub fn unsubscribe_all(&self, ids: &[u64]) -> Result<Vec<MutationResult>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch(|ack| Command::UGCUnsubscribe(owned, ack))
    }

    /// Ask the Workshop which of these items is out of date on disk, and start
    /// a download for each one that is.
    ///
    /// Returns the ids it queued. Distinct from reading `mod_states`: that
    /// reports what the Steam *client* last noticed, which lags the Workshop
    /// and is exactly how a server comes to refuse a connection for an outdated
    /// mod list that the launcher had just called ready.
    ///
    /// Best-effort — an id the Workshop cannot answer for is left alone, and a
    /// check that cannot start promptly is abandoned rather than made to wait
    /// (see [`Self::dispatch_within`]). The caller reports an unchecked join as
    /// unchecked; it does not refuse to join.
    pub fn refresh_stale(&self, ids: &[u64]) -> Result<Vec<u64>, SteamError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let owned = ids.to_vec();
        self.dispatch_within(REFRESH_STALE_BUDGET, |ack| {
            Command::UGCRefreshStale(owned, ack)
        })
    }

    /// Get the install folder for a workshop item.
    pub fn mod_folder(&self, workshop_id: u64) -> Result<Option<PathBuf>, SteamError> {
        self.dispatch(|ack| Command::UGCInstallInfo(workshop_id, ack))
            .map(|opt| opt.map(|info| PathBuf::from(info.folder)))
    }
}

impl SteamHandle {
    /// Request an internet server list, receiving rows as Steam delivers them.
    ///
    /// The returned receiver yields `StreamChunk::Rows` batches followed by
    /// exactly one `StreamChunk::Done`. Dropping it asks the actor to abandon
    /// the request at its next flush.
    ///
    /// Prefer this over [`ServerListSource::internet_list`] for anything the
    /// user is waiting on: the blocking variant returns nothing at all until
    /// Steam has finished querying every server on the list.
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

impl ServerListSource for SteamHandle {
    fn internet_list(&self, filters: &Filters) -> Result<Vec<GameServerRow>, SteamError> {
        let filters = filters.clone();
        self.dispatch(|ack| Command::InternetList(filters, ack))
    }

    fn history_list(&self) -> Result<Vec<GameServerRow>, SteamError> {
        self.dispatch(Command::HistoryList)
    }
}
