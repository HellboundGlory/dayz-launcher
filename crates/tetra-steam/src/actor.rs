use crate::error::{InitFailure, SteamError};
use crate::rows::GameServerRow;
use crate::source::Filters;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

/// Per-item verdict from a VERIFY, in the shape the Mods tab reports it.
///
/// Deliberately richer than the join gate's freshness check, which only asks
/// "which ids did I re-queue?". Verify is a user-facing action with a result to
/// state ("13 checked, 2 outdated, 2 repaired"), so each id comes back with the
/// whole story: whether the Workshop answered, whether it holds a newer copy,
/// and whether a download was started.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StaleOutcome {
    /// Stringified: Workshop ids exceed JS's safe integer range.
    pub workshop_id: String,
    /// The Workshop answered for this id at all. `false` means the item is
    /// private, removed, or the query never answered — it could not be checked,
    /// and nothing was downloaded for it.
    pub known: bool,
    /// The Workshop's copy is newer than what is on disk, or nothing is on disk
    /// at all, so the item is out of date and needs downloading.
    pub outdated: bool,
    /// A high-priority download was queued for it.
    pub queued: bool,
}

/// One subscribed Workshop item, in the shape the Mods tab renders.
///
/// The whole tab's data model in one row: local install facts read straight from
/// Steam (size, folder, state, progress) plus metadata answered by a Workshop
/// details query (title, preview image, dates, votes, URL). Only DayZ items
/// (appid 221100 / 245340) and items the Workshop no longer answers for are
/// ever carried out of the actor — every other game's subscriptions are dropped
/// here, not at the UI.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubscribedModInfo {
    /// Stringified: Workshop ids exceed JS's safe integer range.
    pub workshop_id: String,
    /// Subscribed but disabled in the Steam client, so it is not applied
    /// anywhere. Detected by diffing Steam's subscribed-item reads — there is
    /// no disabled bit in the item state.
    pub locally_disabled: bool,
    /// The Workshop no longer answers for this id while Steam still lists it as
    /// subscribed. Hidden from the list by the frontend and offered as
    /// clean-up, rather than shown as a broken row.
    pub removed: bool,
    /// Whether the item belongs to a DayZ appid. Every other item is filtered
    /// out before this struct is built; `false` only survives for `removed`
    /// items, whose appid is unknowable and which are surfaced purely so the
    /// user can clean them up.
    pub for_dayz: bool,
    /// Classified install state — the same dots the details panel renders.
    pub state: crate::workshop::ModState,
    /// Bytes on disk, stringified for the same JS-range reason as the id.
    pub size_on_disk: String,
    /// When Steam says the item was installed (unix seconds). The fallback
    /// "subscribed date" when the Workshop's own `time_added_to_user_list` is
    /// absent.
    pub install_timestamp: u32,
    /// The item's install folder, when Steam reports one.
    pub folder: Option<String>,
    /// Bytes moved so far, only while Steam is transferring the item.
    pub downloaded: Option<String>,
    /// Total bytes of the transfer in flight, when there is one.
    pub total: Option<String>,
    // ── Workshop metadata, empty when the query did not answer ──
    pub title: Option<String>,
    pub preview_url: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub workshop_url: Option<String>,
    pub consumer_app_id: Option<u32>,
    pub time_created: u32,
    pub time_updated: u32,
    /// When the user added the item to their subscriptions, when Steam records
    /// it. Subscriptions older than the field read 0 — the frontend falls back
    /// to `install_timestamp`.
    pub time_added_to_user_list: u32,
    pub file_size: u32,
    /// Stringified (`u64` on the wire).
    pub num_subscriptions: String,
    pub num_upvotes: u32,
    pub num_downvotes: u32,
    pub score: f32,
}

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
    /// Ask the Workshop itself which of these items have been updated since the
    /// installed copy was written, and queue a download for the ones that have.
    ///
    /// Answers with the ids it queued. Issued instantly and completed later by
    /// `poll_checks`, so it is serviceable from inside a discovery's pump
    /// rather than queued behind the discovery — see `PendingCheck`.
    UGCRefreshStale(Vec<u64>, Sender<Result<Vec<u64>, SteamError>>),
    /// The Mods tab's VERIFY: the same freshness question as the gate, answered
    /// per id instead of as a list of ids to re-queue, and treating
    /// "subscribed but not on disk yet" as out of date too.
    UGCVerifyMods(Vec<u64>, Sender<Result<Vec<StaleOutcome>, SteamError>>),
    /// The Mods tab's enumeration: every subscribed Workshop item, filtered to
    /// DayZ, with install facts and Workshop metadata.
    ///
    /// `cache_age_secs` is passed to `SetAllowCachedResponse`, so re-opening the
    /// tab is cheap (Steam answers from its own metadata cache) while a manual
    /// refresh can pass 0 and force a live Workshop answer.
    SubscribedMods {
        cache_age_secs: u32,
        ack: Sender<Result<Vec<SubscribedModInfo>, SteamError>>,
    },
    /// Queue a fresh download of each id, answering with the ones Steam
    /// accepted. Synchronous — used for the Mods tab's per-mod "reinstall" and
    /// for re-pinning something after its folder was cleared.
    UGCDownload(Vec<u64>, Sender<Result<Vec<u64>, SteamError>>),
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
fn service_instant(
    client: &Client,
    cmd: Command,
    pending: &mut Vec<PendingCheck>,
) -> Option<Command> {
    match cmd {
        // Instant in the sense that matters here: issuing the queries needs no
        // pump of its own, so this is safe to service from inside one. The
        // replies are collected by `poll_checks` on a later turn of whatever
        // loop is running — which is what keeps a join clicked during a
        // discovery from waiting for the discovery to end.
        Command::UGCRefreshStale(ids, ack) => {
            if let Some(started) = start_refresh(client, ids, ack) {
                pending.push(started);
            }
            None
        }
        Command::UGCVerifyMods(ids, ack) => {
            if let Some(started) = start_verify(client, ids, ack) {
                pending.push(started);
            }
            None
        }
        Command::SubscribedMods {
            cache_age_secs,
            ack,
        } => {
            if let Some(started) = start_mod_enumeration(client, ack, cache_age_secs) {
                pending.push(started);
            }
            None
        }
        Command::UGCDownload(ids, ack) => {
            let ugc = client.ugc();
            let accepted: Vec<u64> = ids
                .into_iter()
                .filter(|id| crate::workshop::ModState::is_workshop_id(*id))
                .filter(|id| ugc.download_item(steamworks::PublishedFileId(*id), true))
                .collect();
            let _ = ack.send(Ok(accepted));
            None
        }
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
    // Check-and-enumerate commands issued but not yet answered. Drained by
    // `poll_checks` on every turn of this loop and of `request_list`'s.
    let mut pending: Vec<PendingCheck> = Vec::new();

    loop {
        client.run_callbacks();
        poll_checks(&client, &mut pending);

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
                    &mut pending,
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
                    &mut pending,
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
                    &mut pending,
                ));
            }
            Ok(
                cmd @ (Command::UGCItemState(..)
                | Command::UGCItemStates(..)
                | Command::UGCInstallInfo(..)
                | Command::UGCDownloadInfo(..)
                | Command::UGCRefreshStale(..)
                | Command::UGCVerifyMods(..)
                | Command::SubscribedMods { .. }
                | Command::UGCDownload(..)),
            ) => {
                service_instant(&client, cmd, &mut pending);
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

/// Steam's cap on results per UGC details request (`kNumUGCResultsPerPage`).
/// A 104-mod server — which the DayZ browser is full of — is three requests.
const UGC_QUERY_PAGE: usize = 50;

/// Ceiling on the whole batch of details queries.
///
/// Shorter than `MUTATION_DEADLINE` because this is on the path of a button
/// click: a join that cannot check freshness should get on with launching
/// against what Steam already believes, not sit for a minute first.
const QUERY_DEADLINE: Duration = Duration::from_secs(20);

/// How long the Mods tab will wait for a full enumeration before answering with
/// what it has. Bigger than `QUERY_DEADLINE` because the *first* pull has no
/// Steam-side cache to answer from, and a user subscribed to items from several
/// games can take a couple of round trips; an empty list is a worse outcome
/// than a slow tab.
const ENUM_DEADLINE: Duration = Duration::from_secs(60);

/// Appids whose Workshop items the Mods tab understands: DayZ and DayZ
/// Experimental. A `GetSubscribedItems` read returns *everything* the user is
/// subscribed to across Steam, so this filter is what keeps the tab from
/// listing mods for other games.
const DAYZ_APP_IDS: &[u32] = &[DAYZ_APP_ID, 245340];

/// Metadata one Workshop details query returns for one item.
///
/// Almost everything here is straight out of `SteamUGCDetails_t`; the preview
/// image and the subscriber count come from separate accessors on the same
/// query result, which is why they are collected next to the rest rather than
/// in a second pass.
#[derive(Debug, Clone)]
struct WorkshopDetails {
    title: String,
    preview_url: Option<String>,
    description: String,
    tags: Vec<String>,
    workshop_url: String,
    consumer_app_id: Option<u32>,
    time_created: u32,
    time_updated: u32,
    time_added_to_user_list: u32,
    file_size: u32,
    num_subscriptions: u64,
    num_upvotes: u32,
    num_downvotes: u32,
    score: f32,
}

/// The pooled state of one issued details query: questions asked, answers
/// arriving, and what was on disk when it started.
///
/// Issuing and awaiting are deliberately split. The queries are answered by
/// Steam callbacks, which only run inside `run_callbacks` — so a query issued
/// with its own pump is a query that cannot run *while any other pump is busy*
/// (see the history in this file about the join gate starving behind a
/// discovery). `.finished`/`.issued` are what let the answer be completed by
/// whichever loop happens to be pumping callbacks.
struct IssuedDetails {
    /// The ids asked about, deduped and Workshop-only.
    ids: Vec<u64>,
    /// Disk-side install timestamps, read while the ids were still to hand.
    installed: HashMap<u64, u32>,
    /// Workshop `time_updated` answers, filled in by the query callbacks.
    updated: Arc<Mutex<HashMap<u64, u32>>>,
    /// Full metadata answers. Only the enumeration consumes these, but the
    /// queries are shared, so the answers are pooled here for anyone.
    details: Arc<Mutex<HashMap<u64, WorkshopDetails>>>,
    /// Chunks that have answered, however they answered.
    finished: Arc<AtomicUsize>,
    /// Chunks actually issued. Fewer than expected if Steam refused a request.
    issued: usize,
    deadline: Instant,
}

/// A details query that has been issued and is waiting on replies, together
/// with what to do with them once they are all in (or the deadline passes).
///
/// One enum instead of three parallel vecs so every consumer of the pending
/// list — `run`'s loop, `service_instant`, `request_list` — threads a single
/// collection around, and a new check that follows the same issue-now/
/// complete-later shape slots into the same plumbing.
enum PendingCheck {
    /// The join gate's freshness check. Queues a download for anything stale
    /// and answers with the ids it re-queued, as before.
    Refresh {
        issued: IssuedDetails,
        ack: Sender<Result<Vec<u64>, SteamError>>,
    },
    /// The Mods tab's VERIFY. Answers per id with the full staleness verdict.
    Verify {
        issued: IssuedDetails,
        ack: Sender<Result<Vec<StaleOutcome>, SteamError>>,
    },
    /// The Mods tab's enumeration. Carries the local per-id rows assembled at
    /// issue time; the answers fill in details and decide DayZ-eligibility.
    Enumerate {
        issued: IssuedDetails,
        rows: HashMap<u64, SubscribedModInfo>,
        ack: Sender<Result<Vec<SubscribedModInfo>, SteamError>>,
    },
}

/// Issue a details query for `ids`, split into Steam's page-cap chunks, and
/// return the pooled answer state for some later pump to complete.
///
/// `cache_age_secs` is what makes re-reading the Mods tab cheap: within that
/// age Steam answers from its own metadata cache instead of hitting the
/// Workshop. The join gate's freshness check passes `0` on purpose — cached
/// metadata is exactly the lag that produced the wrong `NEEDS_UPDATE` bit in
/// the first place, so a staleness check that accepted a cached answer would
/// only confirm its own mistake.
///
/// Returns `None` when Steam refused every request — nothing is coming.
fn issue_details_query(
    client: &Client,
    ids: Vec<u64>,
    cache_age_secs: u32,
    deadline: Instant,
) -> Option<IssuedDetails> {
    let ugc = client.ugc();

    // What is on disk. Local calls, no pump needed.
    let installed: HashMap<u64, u32> = ids
        .iter()
        .filter_map(|&id| {
            ugc.item_install_info(steamworks::PublishedFileId(id))
                .map(|info| (id, info.timestamp))
        })
        .collect();

    // Every chunk is issued before anything is awaited, so the round trips
    // overlap instead of running one page at a time.
    let updated: Arc<Mutex<HashMap<u64, u32>>> = Arc::new(Mutex::new(HashMap::new()));
    let details: Arc<Mutex<HashMap<u64, WorkshopDetails>>> = Arc::new(Mutex::new(HashMap::new()));
    let finished = Arc::new(AtomicUsize::new(0));
    let mut issued = 0usize;

    for chunk in ids.chunks(UGC_QUERY_PAGE) {
        let page: Vec<steamworks::PublishedFileId> = chunk
            .iter()
            .map(|&id| steamworks::PublishedFileId(id))
            .collect();
        let Ok(query) = ugc.query_items(page) else {
            continue;
        };
        issued += 1;
        let slot_updated = Arc::clone(&updated);
        let slot_details = Arc::clone(&details);
        let done = Arc::clone(&finished);
        query
            .allow_cached_response(cache_age_secs)
            .fetch(move |result| {
                // `results.iter()` yields one `Option<QueryResult>` per returned
                // index, so the index doubles as the handle for that row's preview
                // URL and subscriber count.
                if let Ok(results) = result {
                    let mut upd = slot_updated.lock().unwrap_or_else(|e| e.into_inner());
                    let mut det = slot_details.lock().unwrap_or_else(|e| e.into_inner());
                    for (index, item) in results.iter().enumerate() {
                        let Some(item) = item else {
                            continue;
                        };
                        let id = item.published_file_id.0;
                        upd.insert(id, item.time_updated);
                        det.insert(
                            id,
                            WorkshopDetails {
                                title: item.title,
                                preview_url: results.preview_url(index as u32),
                                description: item.description,
                                tags: item.tags,
                                workshop_url: item.url,
                                consumer_app_id: item.consumer_app_id.map(|a| a.0),
                                time_created: item.time_created,
                                time_updated: item.time_updated,
                                time_added_to_user_list: item.time_added_to_user_list,
                                file_size: item.file_size,
                                num_subscriptions: results
                                    .statistic(
                                        index as u32,
                                        steamworks::UGCStatisticType::Subscriptions,
                                    )
                                    .unwrap_or(0),
                                num_upvotes: item.num_upvotes,
                                num_downvotes: item.num_downvotes,
                                score: item.score,
                            },
                        );
                    }
                }
                done.fetch_add(1, Ordering::Relaxed);
            });
    }

    if issued == 0 {
        return None;
    }

    Some(IssuedDetails {
        ids,
        installed,
        updated,
        details,
        finished,
        issued,
        deadline,
    })
}

/// Ask the Workshop which of `ids` has been updated since the copy on disk.
///
/// Returns the in-flight state, or `None` when the answer needed no query at
/// all — in which case the caller has already been acknowledged.
fn start_refresh(
    client: &Client,
    ids: Vec<u64>,
    ack: Sender<Result<Vec<u64>, SteamError>>,
) -> Option<PendingCheck> {
    let ids = workshop_only_ids(ids);
    if ids.is_empty() {
        let _ = ack.send(Ok(Vec::new()));
        return None;
    }
    let Some(issued) = issue_details_query(client, ids, 0, Instant::now() + QUERY_DEADLINE) else {
        let _ = ack.send(Err(SteamError::Request(
            "Steam refused the Workshop details request".into(),
        )));
        return None;
    };
    Some(PendingCheck::Refresh { issued, ack })
}

/// The Mods tab's VERIFY: per-id staleness verdicts, queuing a download for
/// anything the Workshop has moved past *or* that is not on disk yet.
fn start_verify(
    client: &Client,
    ids: Vec<u64>,
    ack: Sender<Result<Vec<StaleOutcome>, SteamError>>,
) -> Option<PendingCheck> {
    let ids = workshop_only_ids(ids);
    if ids.is_empty() {
        let _ = ack.send(Ok(Vec::new()));
        return None;
    }
    let Some(issued) = issue_details_query(client, ids, 0, Instant::now() + QUERY_DEADLINE) else {
        let _ = ack.send(Err(SteamError::Request(
            "Steam refused the Workshop details request".into(),
        )));
        return None;
    };
    Some(PendingCheck::Verify { issued, ack })
}

/// Enumerate every subscribed Workshop item for the Mods tab.
fn start_mod_enumeration(
    client: &Client,
    ack: Sender<Result<Vec<SubscribedModInfo>, SteamError>>,
    cache_age_secs: u32,
) -> Option<PendingCheck> {
    let ugc = client.ugc();

    // Everything Steam lists as subscribed, disabled ones included.
    let all: Vec<u64> = ugc
        .subscribed_items(true)
        .into_iter()
        .map(|id| id.0)
        .collect();

    // The enabled-only read is how "locally disabled" is detected at all: the
    // item state has no disabled bit, but `GetSubscribedItems` answers
    // differently when asked to include disabled items, and the difference
    // between the two reads is exactly the disabled set.
    let enabled: HashSet<u64> = ugc
        .subscribed_items(false)
        .into_iter()
        .map(|id| id.0)
        .collect();
    let disabled: HashSet<u64> = all
        .iter()
        .copied()
        .filter(|id| !enabled.contains(id))
        .collect();

    if all.is_empty() {
        let _ = ack.send(Ok(Vec::new()));
        return None;
    }

    // Assemble the local half of every row now; the details query fills the
    // rest in `poll_checks`.
    let mut rows: HashMap<u64, SubscribedModInfo> = HashMap::with_capacity(all.len());
    for &id in &all {
        let file = steamworks::PublishedFileId(id);
        let info = ugc.item_install_info(file);
        let state = ugc.item_state(file);
        let (downloaded, total) = ugc.item_download_info(file).unwrap_or((0, 0));
        rows.insert(
            id,
            SubscribedModInfo {
                workshop_id: id.to_string(),
                locally_disabled: disabled.contains(&id),
                removed: false,
                for_dayz: false,
                state: crate::workshop::ModState::from_bits(state.bits()),
                size_on_disk: info
                    .as_ref()
                    .map(|i| i.size_on_disk.to_string())
                    .unwrap_or_default(),
                install_timestamp: info.as_ref().map(|i| i.timestamp).unwrap_or(0),
                folder: info.map(|i| i.folder),
                downloaded: (downloaded > 0).then(|| downloaded.to_string()),
                total: (total > 0).then(|| total.to_string()),
                title: None,
                preview_url: None,
                description: None,
                tags: Vec::new(),
                workshop_url: None,
                consumer_app_id: None,
                time_created: 0,
                time_updated: 0,
                time_added_to_user_list: 0,
                file_size: 0,
                num_subscriptions: String::new(),
                num_upvotes: 0,
                num_downvotes: 0,
                score: 0.0,
            },
        );
    }

    let Some(issued) =
        issue_details_query(client, all, cache_age_secs, Instant::now() + ENUM_DEADLINE)
    else {
        // Steam refused every details request. Answer with the local-only
        // snapshot rather than failing the whole tab — the rows lack titles and
        // thumbnails until the next pull, but the list itself is there.
        let rows: Vec<SubscribedModInfo> = rows.into_values().collect();
        let _ = ack.send(Ok(rows));
        return None;
    };

    Some(PendingCheck::Enumerate { issued, rows, ack })
}

/// Deduplicate ids and drop anything that is not a Workshop id.
///
/// `mutate` does the same for subscribe/unsubscribe, and for the same reason:
/// a duplicate id would make the completion count unreachable (see `mutate`),
/// and id 0 is how DayZ servers denote server-side content that Steam must
/// never be asked about.
fn workshop_only_ids(ids: Vec<u64>) -> Vec<u64> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .filter(|id| crate::workshop::ModState::is_workshop_id(*id))
        .filter(|id| seen.insert(*id))
        .collect()
}

/// Complete any pending check whose replies have all landed, or whose deadline
/// has passed.
///
/// Called from every loop that pumps callbacks, so work issued during a
/// discovery completes during that discovery rather than after it.
fn poll_checks(client: &Client, pending: &mut Vec<PendingCheck>) {
    if pending.is_empty() {
        return;
    }
    let ugc = client.ugc();
    pending.retain_mut(|p| {
        match p {
            PendingCheck::Refresh { issued, ack } => {
                let answered = issued.finished.load(Ordering::Relaxed) >= issued.issued;
                let expired = Instant::now() > issued.deadline;
                if !answered && !expired {
                    return true;
                }
                // A timed-out check still uses whatever did answer. Ids the
                // Workshop said nothing about read as `updated_at == 0`, which
                // `is_stale` treats as "leave it alone" — partial data can only
                // ever mean fewer forced downloads, never spurious ones.
                let updated = issued
                    .updated
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let mut queued = Vec::new();
                for &id in &issued.ids {
                    let installed_at = issued.installed.get(&id).copied().unwrap_or(0);
                    let updated_at = updated.get(&id).copied().unwrap_or(0);
                    if !crate::workshop::is_stale(installed_at, updated_at) {
                        continue;
                    }
                    // High priority: someone is waiting on this to join, so it
                    // must not queue behind an unrelated library download.
                    if ugc.download_item(steamworks::PublishedFileId(id), true) {
                        queued.push(id);
                    }
                }
                let _ = ack.send(Ok(queued));
                false
            }
            PendingCheck::Verify { issued, ack } => {
                let answered = issued.finished.load(Ordering::Relaxed) >= issued.issued;
                let expired = Instant::now() > issued.deadline;
                if !answered && !expired {
                    return true;
                }
                let updated = issued
                    .updated
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let mut outcomes = Vec::with_capacity(issued.ids.len());
                for &id in &issued.ids {
                    let installed_at = issued.installed.get(&id).copied().unwrap_or(0);
                    let known = updated.contains_key(&id);
                    let updated_at = updated.get(&id).copied().unwrap_or(0);
                    // "Updated" is deliberately wider than the join gate's
                    // `is_stale`: an already-subscribed mod that is not on disk
                    // yet is exactly what a manual VERIFY should bring down,
                    // while the gate treats it as blocked by its own state and
                    // subscribes first.
                    let outdated =
                        updated_at != 0 && (installed_at == 0 || updated_at > installed_at);
                    let queued =
                        outdated && ugc.download_item(steamworks::PublishedFileId(id), true);
                    outcomes.push(StaleOutcome {
                        workshop_id: id.to_string(),
                        known,
                        outdated,
                        queued,
                    });
                }
                let _ = ack.send(Ok(outcomes));
                false
            }
            PendingCheck::Enumerate { issued, rows, ack } => {
                let answered = issued.finished.load(Ordering::Relaxed) >= issued.issued;
                let expired = Instant::now() > issued.deadline;
                if !answered && !expired {
                    return true;
                }
                let details = issued
                    .details
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let mut out = Vec::with_capacity(rows.len());
                for (id, mut info) in rows.drain() {
                    let Some(d) = details.get(&id) else {
                        // No answer at all for this id. If every chunk answered,
                        // the Workshop knows nothing about it — a removed/banned
                        // item, surfaced for clean-up rather than shown. If the
                        // query timed out instead, the id is dropped from this
                        // pass (the next pull picks it up) rather than guessed
                        // at.
                        if answered {
                            info.removed = true;
                            out.push(info);
                        }
                        continue;
                    };
                    info.for_dayz = d
                        .consumer_app_id
                        .map(|app| DAYZ_APP_IDS.contains(&app))
                        .unwrap_or(false);
                    // Non-DayZ items never reach the user; removed items of an
                    // unknown app only do so as clean-up candidates.
                    if !info.for_dayz && !info.removed {
                        continue;
                    }
                    info.title = Some(d.title.clone());
                    info.preview_url = d.preview_url.clone();
                    info.description = Some(d.description.clone());
                    info.tags = d.tags.clone();
                    info.workshop_url = Some(d.workshop_url.clone());
                    info.consumer_app_id = d.consumer_app_id;
                    info.time_created = d.time_created;
                    info.time_updated = d.time_updated;
                    info.time_added_to_user_list = d.time_added_to_user_list;
                    info.file_size = d.file_size;
                    info.num_subscriptions = d.num_subscriptions.to_string();
                    info.num_upvotes = d.num_upvotes;
                    info.num_downvotes = d.num_downvotes;
                    info.score = d.score;
                    out.push(info);
                }
                let _ = ack.send(Ok(out));
                false
            }
        }
    });
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
    pending: &mut Vec<PendingCheck>,
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
            if let Some(unhandled) = service_instant(client, cmd, pending) {
                deferred.push_back(unhandled);
            }
        }

        // Complete any pending check issued above. Without this a join
        // clicked during a discovery would have its queries answered by this
        // very loop and still sit unacknowledged until the discovery ended, and
        // the same would hold for a Mods-tab enumeration or verify.
        poll_checks(client, pending);

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
