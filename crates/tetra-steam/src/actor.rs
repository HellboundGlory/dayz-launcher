use crate::error::{InitFailure, SteamError};
use crate::rows::GameServerRow;
use crate::source::Filters;
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use steamworks::{
    Client, ServerListCallbacks, ServerResponse, SteamAPIInitError, SteamServersConnected,
    SteamServersDisconnected,
};

pub const DAYZ_APP_ID: u32 = 221100;

const REQUEST_DEADLINE: Duration = Duration::from_secs(300);
/// Idle pump cadence, when no request is in flight.
const PUMP_INTERVAL: Duration = Duration::from_millis(50);
/// Pump cadence *during* a request. Server-list callbacks are only delivered
/// inside `run_callbacks`, so this bounds how promptly results are drained.
/// Was 10ms; the tracing line at the end of `request_list` reports the actual
/// first-row and total timings, so the effect of changing it is measurable
/// rather than guessed at.
const PUMP_SLEEP: Duration = Duration::from_millis(1);

// ── Simple sync UGC types ──────────────────────────────────────

#[derive(Debug, Clone)]
pub struct UgcInstallInfo {
    pub folder: String,
    /// Reported by Steam alongside the folder. Nothing reads it yet — the mod
    /// gate only needs the path — but it is what a "needs N MB" prompt in the
    /// mod manager will be built from, so it is carried rather than dropped.
    #[allow(dead_code)]
    pub size_on_disk: u64,
}

/// One instalment of a streaming server list.
///
/// Steam delivers a server list one `responded` callback at a time over tens of
/// seconds. Buffering all of them and returning at the end means the user
/// stares at an empty table for the whole request even though rows were
/// available a second in. `Rows` carries whatever has accumulated since the
/// last flush; exactly one `Done` always terminates the stream.
#[derive(Debug)]
pub enum StreamChunk {
    Rows(Vec<GameServerRow>),
    Done(Result<(), SteamError>),
}

/// How often accumulated rows are flushed to a streaming consumer.
const STREAM_FLUSH: Duration = Duration::from_millis(200);

/// One item's transfer progress: `(workshop_id, bytes_downloaded, bytes_total)`.
pub type DownloadRow = (u64, u64, u64);

pub(crate) enum Command {
    InternetList(Filters, Sender<Result<Vec<GameServerRow>, SteamError>>),
    InternetListStream(Filters, Sender<StreamChunk>),
    HistoryList(Sender<Result<Vec<GameServerRow>, SteamError>>),
    /// Returns item state bitmask (u32).
    UGCItemState(u64, Sender<Result<u32, SteamError>>),
    /// Batched `item_state`, returned as `(id, bits)` pairs.
    ///
    /// One command rather than one per mod: the actor runs a callback pump
    /// between every command it services, so asking about a 93-mod server
    /// individually would interleave 93 pumps with the queries. Pairs rather
    /// than a positional `Vec` so a caller can never mis-associate a state with
    /// the wrong mod.
    UGCItemStates(Vec<u64>, Sender<Result<Vec<(u64, u32)>, SteamError>>),
    /// Returns install folder + size, or None.
    UGCInstallInfo(u64, Sender<Result<Option<UgcInstallInfo>, SteamError>>),
    /// Batched download progress.
    ///
    /// Only ids Steam reports a transfer for are included — the call returns
    /// `None` for anything not downloading.
    UGCDownloadInfo(Vec<u64>, Sender<Result<Vec<DownloadRow>, SteamError>>),
    /// Subscribe to each id, then queue its download.
    UGCSubscribe(Vec<u64>, Sender<Result<Vec<MutationResult>, SteamError>>),
    /// Unsubscribe from each id. Steam removes the content from disk.
    UGCUnsubscribe(Vec<u64>, Sender<Result<Vec<MutationResult>, SteamError>>),
    Shutdown(Sender<()>),
}

/// Outcome of one subscribe/unsubscribe. `error` is `None` on success.
///
/// Per-id rather than a single pass/fail for the batch: subscribing 93 mods can
/// partially succeed, and "subscribed 91 of 93" is a real outcome the UI has to
/// be able to state.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MutationResult {
    pub workshop_id: u64,
    pub error: Option<String>,
}

/// Ceiling on a batch of subscribe/unsubscribe callbacks.
///
/// Every failure surface gets a message rather than an indefinite spinner
/// (spec §5.6), so a callback that never fires has to become a timeout.
const MUTATION_DEADLINE: Duration = Duration::from_secs(60);

/// Answer a command that resolves instantly from local Steam state, needing no
/// callback pump of its own.
///
/// Returns `Some(cmd)` for anything it did not handle, so the caller can queue
/// it for the main loop. These are the "fast" half of the command taxonomy:
/// they are safe to service *inside* a long-running server-list request, which
/// is what stops a mod-state lookup from waiting on a discovery that may run
/// for a minute.
fn service_instant(client: &Client, cmd: Command) -> Option<Command> {
    match cmd {
        Command::UGCItemState(id, ack) => {
            let _ = ack.send(Ok(client
                .ugc()
                .item_state(steamworks::PublishedFileId(id))
                .bits()));
            None
        }
        Command::UGCItemStates(ids, ack) => {
            let ugc = client.ugc();
            let states = ids
                .into_iter()
                .map(|id| (id, ugc.item_state(steamworks::PublishedFileId(id)).bits()))
                .collect();
            let _ = ack.send(Ok(states));
            None
        }
        Command::UGCInstallInfo(id, ack) => {
            let result = client
                .ugc()
                .item_install_info(steamworks::PublishedFileId(id))
                .map(|info| UgcInstallInfo {
                    folder: info.folder,
                    size_on_disk: info.size_on_disk,
                });
            let _ = ack.send(Ok(result));
            None
        }
        Command::UGCDownloadInfo(ids, ack) => {
            let ugc = client.ugc();
            let progress = ids
                .into_iter()
                .filter_map(|id| {
                    ugc.item_download_info(steamworks::PublishedFileId(id))
                        .map(|(downloaded, total)| (id, downloaded, total))
                })
                .collect();
            let _ = ack.send(Ok(progress));
            None
        }
        // Everything else either blocks (list requests) or runs a callback pump
        // of its own (subscribe/unsubscribe), so it must not be nested inside
        // another pump.
        other => Some(other),
    }
}

/// Classify a Steamworks init failure so the launcher knows whether waiting can
/// help. Steam distinguishes these three cases itself; collapsing them into one
/// string would leave the startup prompt unable to tell "start Steam" (fixable
/// by waiting) from "this Steam client is out of date" (not).
///
/// `FailedGeneric` is what a *starting* Steam client returns, not only a broken
/// one — it appears for the several seconds between the process launching and
/// it being ready to hand out sessions.
fn classify(e: &SteamAPIInitError) -> InitFailure {
    match e {
        SteamAPIInitError::NoSteamClient(_) => InitFailure::SteamNotRunning,
        SteamAPIInitError::VersionMismatch(_) => InitFailure::SteamOutOfDate,
        SteamAPIInitError::FailedGeneric(_) => InitFailure::SteamNotReady,
    }
}

/// Steam's own message text.
///
/// Pulled out of the variant rather than taken from `Display`, which discards
/// it: `SteamAPIInitError::FailedGeneric` renders as the literally useless
/// "Some other failure" while carrying Steam's actual explanation inside.
fn detail(e: &SteamAPIInitError) -> String {
    let message = match e {
        SteamAPIInitError::FailedGeneric(m)
        | SteamAPIInitError::NoSteamClient(m)
        | SteamAPIInitError::VersionMismatch(m) => m,
    };
    if message.trim().is_empty() {
        e.to_string()
    } else {
        message.clone()
    }
}

pub(crate) fn run(
    rx: Receiver<Command>,
    ready: Sender<Result<(), SteamError>>,
    connected: Arc<AtomicBool>,
) {
    let client = match Client::init_app(DAYZ_APP_ID) {
        Ok(c) => c,
        Err(e) => {
            let _ = ready.send(Err(SteamError::Init(classify(&e), detail(&e))));
            return;
        }
    };
    if ready.send(Ok(())).is_err() {
        return;
    }

    // Kept alive for the life of the loop below — a `CallbackHandle` drops
    // its registration, so binding these to `_` would unregister them
    // immediately instead of leaving them listening.
    let disconnected_flag = Arc::clone(&connected);
    let _disconnected_cb = client.register_callback(move |_: SteamServersDisconnected| {
        disconnected_flag.store(false, Ordering::Relaxed);
    });
    let connected_flag = Arc::clone(&connected);
    let _connected_cb = client.register_callback(move |_: SteamServersConnected| {
        connected_flag.store(true, Ordering::Relaxed);
    });

    // Commands that arrived while a server-list request held the thread, and
    // could not be answered inline.
    let mut deferred: VecDeque<Command> = VecDeque::new();

    loop {
        client.run_callbacks();

        let next = match deferred.pop_front() {
            Some(cmd) => Ok(cmd),
            None => rx.recv_timeout(PUMP_INTERVAL),
        };

        match next {
            Ok(Command::InternetList(filters, ack)) => {
                let _ = ack.send(request_list(
                    &client,
                    &filters,
                    ListKind::Internet,
                    None,
                    &rx,
                    &mut deferred,
                ));
            }
            Ok(Command::InternetListStream(filters, tx)) => {
                let result = request_list(
                    &client,
                    &filters,
                    ListKind::Internet,
                    Some(&tx),
                    &rx,
                    &mut deferred,
                );
                let _ = tx.send(StreamChunk::Done(result.map(|_| ())));
            }
            Ok(Command::HistoryList(ack)) => {
                let _ = ack.send(request_list(
                    &client,
                    &Filters::new(),
                    ListKind::History,
                    None,
                    &rx,
                    &mut deferred,
                ));
            }
            Ok(
                cmd @ (Command::UGCItemState(..)
                | Command::UGCItemStates(..)
                | Command::UGCInstallInfo(..)
                | Command::UGCDownloadInfo(..)),
            ) => {
                service_instant(&client, cmd);
            }
            Ok(Command::UGCSubscribe(ids, ack)) => {
                let _ = ack.send(Ok(mutate(&client, &ids, Mutation::Subscribe)));
            }
            Ok(Command::UGCUnsubscribe(ids, ack)) => {
                let _ = ack.send(Ok(mutate(&client, &ids, Mutation::Unsubscribe)));
            }
            Ok(Command::Shutdown(ack)) => {
                drop(client);
                let _ = ack.send(());
                return;
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mutation {
    Subscribe,
    Unsubscribe,
}

/// Issue a subscribe/unsubscribe for every id, then pump until each has
/// answered or the deadline passes.
///
/// The shared result slot is `Arc<Mutex<_>>`, not the `Rc<RefCell<_>>` used by
/// `request_list`: `register_call_result` requires the callback to be `Send`,
/// so an `Rc` will not compile here. The server-list callbacks get away with
/// `Rc` because they are registered through a different path.
///
/// All ids are issued before any pumping, so the calls overlap rather than
/// running one round trip at a time.
fn mutate(client: &Client, ids: &[u64], kind: Mutation) -> Vec<MutationResult> {
    // Deduplicate, and drop anything that is not a Workshop id.
    //
    // Both matter for correctness, not just tidiness:
    //
    // - A server can list the same mod twice. The completion check below counts
    //   distinct answers, so a duplicated id meant the count could never reach
    //   `ids.len()` and every batch ran to the 60s deadline.
    // - Id `0` is how DayZ servers denote a server-side or locally-installed
    //   mod. Steam does not reject it; `download_item(0)` queues a phantom
    //   transfer that persists in the Steam client until it is restarted.
    let ids: Vec<u64> = {
        let mut seen = std::collections::HashSet::new();
        ids.iter()
            .copied()
            .filter(|id| crate::workshop::ModState::is_workshop_id(*id))
            .filter(|id| seen.insert(*id))
            .collect()
    };
    let ids = &ids[..];

    let answers: Arc<Mutex<HashMap<u64, Option<String>>>> =
        Arc::new(Mutex::new(HashMap::with_capacity(ids.len())));
    let ugc = client.ugc();

    for &id in ids {
        let slot = Arc::clone(&answers);
        let cb = move |res: Result<(), steamworks::SteamError>| {
            slot.lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id, res.err().map(|e| e.to_string()));
        };
        match kind {
            Mutation::Subscribe => ugc.subscribe_item(steamworks::PublishedFileId(id), cb),
            Mutation::Unsubscribe => ugc.unsubscribe_item(steamworks::PublishedFileId(id), cb),
        }
    }

    let deadline = Instant::now() + MUTATION_DEADLINE;
    loop {
        client.run_callbacks();
        if answers.lock().unwrap_or_else(|e| e.into_inner()).len() >= ids.len() {
            break;
        }
        if Instant::now() > deadline {
            break;
        }
        std::thread::sleep(PUMP_SLEEP);
    }

    let answers = answers.lock().unwrap_or_else(|e| e.into_inner()).clone();

    let mut out = Vec::with_capacity(ids.len());
    for &id in ids {
        // An id absent from the map never had its callback fire.
        let error = match answers.get(&id) {
            Some(err) => err.clone(),
            None => Some("Steam did not respond in time".to_string()),
        };

        // Subscribing alone does not reliably start a transfer, so the download
        // is queued explicitly (spec §5.2: subscribe -> download). It is a
        // synchronous call returning whether Steam accepted the request; if
        // Steam already queued one this is a harmless no-op.
        let error = if kind == Mutation::Subscribe && error.is_none() {
            if ugc.download_item(steamworks::PublishedFileId(id), false) {
                None
            } else {
                Some("Subscribed, but Steam would not start the download".to_string())
            }
        } else {
            error
        };

        out.push(MutationResult {
            workshop_id: id,
            error,
        });
    }
    out
}

#[derive(Clone, Copy)]
enum ListKind {
    Internet,
    History,
}

/// Run one server-list request to completion.
///
/// When `stream` is `Some`, rows are flushed to it every `STREAM_FLUSH` and the
/// returned `Vec` is empty — the consumer has already been given everything.
/// When it is `None` the whole list is returned at the end, as before.
fn request_list(
    client: &Client,
    filters: &Filters,
    kind: ListKind,
    stream: Option<&Sender<StreamChunk>>,
    rx: &Receiver<Command>,
    deferred: &mut VecDeque<Command>,
) -> Result<Vec<GameServerRow>, SteamError> {
    let mms = client.matchmaking_servers();

    let rows: Rc<RefCell<Vec<GameServerRow>>> = Rc::new(RefCell::new(Vec::new()));
    let done: Rc<RefCell<Option<ServerResponse>>> = Rc::new(RefCell::new(None));
    // When the first row lands vs. when the request completes. If the gap is
    // large, Steam is trickling results and buffering them until the end is
    // what makes discovery feel slow — not the total wall clock.
    let first_row: Rc<RefCell<Option<Instant>>> = Rc::new(RefCell::new(None));

    let responded_rows = Rc::clone(&rows);
    let first_row_mark = Rc::clone(&first_row);
    let responded = Box::new(
        move |list: std::sync::Arc<std::sync::Mutex<steamworks::ServerListRequest>>, index: i32| {
            if let Ok(guard) = list.lock() {
                if let Ok(item) = guard.get_server_details(index) {
                    if first_row_mark.borrow().is_none() {
                        *first_row_mark.borrow_mut() = Some(Instant::now());
                    }
                    responded_rows.borrow_mut().push(from_item(&item));
                }
            }
        },
    );

    let failed_rows = Rc::clone(&rows);
    let failed = Box::new(
        move |list: std::sync::Arc<std::sync::Mutex<steamworks::ServerListRequest>>, index: i32| {
            if let Ok(guard) = list.lock() {
                if let Ok(item) = guard.get_server_details(index) {
                    let mut row = from_item(&item);
                    row.responded = false;
                    failed_rows.borrow_mut().push(row);
                }
            }
        },
    );

    let done_flag = Rc::clone(&done);
    let refresh_complete = Box::new(
        move |_list: std::sync::Arc<std::sync::Mutex<steamworks::ServerListRequest>>,
              response: ServerResponse| {
            *done_flag.borrow_mut() = Some(response);
        },
    );

    let callbacks = ServerListCallbacks::new(responded, failed, refresh_complete);

    let borrowed: HashMap<&str, &str> = filters
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let request = match kind {
        ListKind::Internet => mms
            .internet_server_list(DAYZ_APP_ID, &borrowed, callbacks)
            .map_err(|_| SteamError::Request("filter key or value exceeds 255 bytes".into()))?,
        ListKind::History => mms
            .history_server_list(DAYZ_APP_ID, &borrowed, callbacks)
            .map_err(|_| SteamError::Request("filter key or value exceeds 255 bytes".into()))?,
    };

    let started = Instant::now();
    let deadline = started + REQUEST_DEADLINE;
    let mut streamed = 0usize;
    let mut last_flush = Instant::now();

    // Draining `rows` here is safe without any lock: server-list callbacks only
    // ever run inside `run_callbacks`, on this same thread, so no callback can
    // be appending while this borrow is live.
    let mut flush = |force: bool, streamed: &mut usize| -> bool {
        let Some(tx) = stream else { return true };
        if !force && last_flush.elapsed() < STREAM_FLUSH {
            return true;
        }
        last_flush = Instant::now();
        let batch: Vec<GameServerRow> = rows.borrow_mut().drain(..).collect();
        if batch.is_empty() {
            return true;
        }
        *streamed += batch.len();
        // A send error means the consumer hung up; stop early rather than
        // keep paying for a list nobody is reading.
        tx.send(StreamChunk::Rows(batch)).is_ok()
    };

    while done.borrow().is_none() {
        if Instant::now() > deadline {
            return Err(SteamError::Timeout);
        }
        client.run_callbacks();

        // Answer instant queries while this request runs. Without this the
        // actor is single-file: a mod-state lookup issued while a discovery is
        // in flight waits for the whole discovery, which made clicking a server
        // during a refresh appear to hang for tens of seconds.
        while let Ok(cmd) = rx.try_recv() {
            if let Some(unhandled) = service_instant(client, cmd) {
                deferred.push_back(unhandled);
            }
        }

        if !flush(false, &mut streamed) {
            break;
        }
        std::thread::sleep(PUMP_SLEEP);
    }
    flush(true, &mut streamed);

    // A broken stream leaves the loop before `done` is set; treat that as a
    // completed-but-empty request rather than panicking on the `expect`.
    let Some(response) = *done.borrow() else {
        return Ok(Vec::new());
    };

    tracing::info!(
        filters = ?filters,
        rows = rows.borrow().len() + streamed,
        streamed,
        first_row_ms = first_row.borrow().map(|t| (t - started).as_millis()),
        total_ms = started.elapsed().as_millis(),
        "steam server list complete"
    );

    if let Ok(mut guard) = request.lock() {
        let _ = guard.release();
    }

    match response {
        ServerResponse::NoServersListedOnMasterServer => Ok(Vec::new()),
        _ => Ok(Rc::try_unwrap(rows)
            .map(RefCell::into_inner)
            .unwrap_or_else(|rc| rc.borrow().clone())),
    }
}

fn from_item(item: &steamworks::GameServerItem) -> GameServerRow {
    let played = item.last_time_played.as_secs();
    GameServerRow {
        ip: item.addr,
        query_port: item.query_port,
        game_port: item.connection_port,
        name: item.server_name.clone(),
        map: item.map.clone(),
        players: item.players,
        max_players: item.max_players,
        bots: item.bot_players,
        ping_ms: item.ping.as_millis() as i32,
        locked: item.have_password,
        vac: item.secure,
        server_version: item.server_version,
        description: item.game_description.clone(),
        tags: item.tags.clone(),
        last_played: (played > 0).then_some(played as i64),
        responded: item.successful_response,
    }
}
