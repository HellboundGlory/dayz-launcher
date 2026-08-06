import { useEffect, useState } from "react";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useLaunchStore, type ActiveOp } from "@/stores/launch-store";
import { Play, ChevronRight, Star, Download, Trash2, Loader2, Check } from "lucide-react";
import {
  launchGame,
  getServerMods,
  toggleFavourite,
  steamModStates,
  steamDownloadProgress,
  steamSubscribeMods,
  steamUnsubscribeMods,
  verifyServerMods,
  type ModState,
} from "@/lib/tauri";
import { joinAction } from "@/lib/join-action";
import { cn, formatBytes, formatGameTime, regionName } from "@/lib/utils";

/**
 * How each state reads and looks. Wording is deliberately factual: Steam cannot
 * distinguish "you never subscribed" from "this id isn't a workshop item", so
 * nothing here may imply a mod is broken or missing from the Workshop.
 */
const MOD_STATE_UI: Record<ModState, { dot: string; text: string; label: string }> = {
  ready: { dot: "#22c55e", text: "text-[#94a3b8]", label: "Installed and up to date" },
  needs_update: { dot: "#f59e0b", text: "text-[#f1f5f9]", label: "Update available" },
  downloading: { dot: "#38bdf8", text: "text-[#f1f5f9]", label: "Downloading" },
  not_installed: { dot: "#64748b", text: "text-[#f1f5f9]", label: "Subscribed, not downloaded" },
  not_subscribed: { dot: "#ef4444", text: "text-[#f1f5f9]", label: "Not subscribed" },
  not_on_workshop: { dot: "#334155", text: "text-[#64748b]", label: "Server-side mod" },
};

/**
 * Mods the user can actually do something about.
 *
 * `not_on_workshop` entries carry no Workshop id, so they cannot be subscribed,
 * downloaded or verified. Counting them as blockers made servers that declare
 * one permanently unjoinable and left "Subscribe and join" waiting for a state
 * that could never arrive.
 */
function isActionable(state: ModState) {
  return state !== "not_on_workshop";
}

/**
 * How often the panel re-reads Steam install state while it's open.
 *
 * Fast enough that a subscribe or a finished download shows up promptly,
 * slow enough to be free — the underlying call is a local Steam lookup with
 * no network round trip.
 */
const MOD_STATE_POLL_MS = 1500;

/**
 * Ceiling on one subscribe-and-join. Big mod sets legitimately take a long
 * time, but the wait must end in a message rather than an indefinite spinner
 * (design spec §5.6).
 */
const FIX_DEADLINE_MS = 45 * 60 * 1000;

/**
 * How long everything can stay completely unchanged — no state transition and
 * no bytes moved — before the wait is called stalled. Steam surfaces no event
 * for "download will never start", so the only detectable signal is that
 * nothing is happening.
 */
const FIX_STALL_MS = 3 * 60 * 1000;

/**
 * How long the JOIN button holds its "DayZ is starting" confirmation.
 *
 * Long enough to still be on screen once DayZ's own window appears — that is
 * the moment the player stops looking at the launcher — and short enough that
 * the button is back to normal if they alt-tab out of a session that failed to
 * connect.
 */
const LAUNCHED_NOTICE_MS = 15_000;

/**
 * How long to keep waiting after forcing an update, before an all-ready reading
 * is believed.
 *
 * `download_item` returns as soon as Steam accepts the request; the item's
 * state bits change a moment later. Poll inside that gap and every mod still
 * reports installed and current — including the one just condemned as stale —
 * so the join would proceed against exactly the content the verification set
 * out to replace.
 */
const REFRESH_SETTLE_MS = 5_000;

/**
 * Short codes for anything that went sideways, in place of a paragraph.
 *
 * The panel has one narrow line to say this in, and an explanation long enough
 * to be complete is long enough to push the JOIN button around and be skipped
 * anyway. A code plus five words fits, stays readable, and is something you can
 * quote in a bug report — the full text is still there on hover.
 *
 * `W` is a warning: the join went ahead, but something was not done.
 * `E` stopped it.
 */
const NOTICES = {
  W01: {
    text: "Mod versions not checked",
    detail:
      "Steam did not answer the Workshop query in time, so the launcher could " +
      "not tell whether any mod is out of date. The mod list itself is current. " +
      "This usually means Steam was busy with a server discovery; joining again " +
      "in a moment will check properly.",
  },
  W02: {
    text: "Downloads stalled",
    detail:
      "Nothing has progressed for a few minutes. Steam pauses Workshop " +
      "downloads during gameplay by default, and it sees this launcher as DayZ. " +
      "Enable Steam → Settings → Downloads → 'Allow downloads during gameplay'.",
  },
  W03: {
    text: "Gave up waiting for downloads",
    detail: "Still not finished after 45 minutes. Steam is still downloading in the background.",
  },
  W04: {
    text: "Stopped waiting",
    detail: "Downloads continue in Steam. Press the join button again when they finish.",
  },
  E01: {
    text: "Could not subscribe",
    detail: "Steam refused to subscribe to one or more of this server's mods.",
  },
} as const;

type NoticeCode = keyof typeof NOTICES;

/** A line under the buttons: either a coded problem or a plain result. */
type Notice =
  | { kind: "code"; code: NoticeCode; extra?: string }
  | { kind: "plain"; text: string };

/**
 * What the working box reads while an operation runs.
 *
 * Most phases carry their own live detail — a count, bytes moved — and the
 * fallbacks are for the two that have nothing to report but still must not
 * render as a generic "Working…". That generic string is what made a failing
 * launch indistinguishable from a slow verification in the one bug report this
 * was written for: every step of the operation looked identical.
 */
function phaseLabel(op: ActiveOp): string {
  if (op.note) return op.note;
  switch (op.phase) {
    case "launching":
      return "LAUNCHING…";
    case "starting":
      return "STARTING DAYZ…";
    case "subscribing":
      return "SUBSCRIBING…";
    case "downloading":
      return "DOWNLOADING…";
    case "verifying":
      return "VERIFYING…";
  }
}

/** Summary line above the mod list. Order is most-blocking first. */
function summarise(states: Map<string, ModState>, total: number) {
  if (states.size === 0) return null;

  const actionable = [...states.values()].filter(isActionable);
  const count = (s: ModState) => actionable.filter((v) => v === s).length;
  const downloading = count("downloading");
  const needsUpdate = count("needs_update");
  const notInstalled = count("not_installed");
  const notSubscribed = count("not_subscribed");
  const blocked = downloading + needsUpdate + notInstalled + notSubscribed;

  if (blocked === 0) {
    const sideload = states.size - actionable.length;
    return {
      tone: "ok" as const,
      text: sideload > 0 ? `${actionable.length} mods ready · ${sideload} server-side` : `All ${total} mods ready`,
    };
  }

  const parts: string[] = [];
  if (needsUpdate) parts.push(`${needsUpdate} need updating`);
  if (downloading) parts.push(`${downloading} downloading`);
  if (notInstalled) parts.push(`${notInstalled} not downloaded`);
  if (notSubscribed) parts.push(`${notSubscribed} not subscribed`);

  return {
    tone: downloading && blocked === downloading ? ("busy" as const) : ("warn" as const),
    text: parts.join(" · "),
  };
}

export function ServerDetails() {
  const selectedServer = useServerStore((s) => s.selectedServer);
  const toggleFavouriteLocal = useServerStore((s) => s.toggleFavourite);
  const setDownloadsActive = useServerStore((s) => s.setDownloadsActive);
  // Field selectors, not a bare `useSettingsStore()`. Subscribing to the whole
  // store re-rendered this panel — mod list, per-mod progress rows and all — on
  // every keystroke in the settings modal's name box, none of which this panel
  // displays.
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const launchParams = useSettingsStore((s) => s.launchParams);
  const autoJoinAfterDownload = useSettingsStore((s) => s.autoJoinAfterDownload);
  /**
   * The one app-wide operation, and whether DayZ is up.
   *
   * All of this was component state until it turned out that switching servers
   * mid-download cancelled the download and erased every trace of it. It lives
   * in a store now so the button tells the truth on every server, not just the
   * one that started the work. See `stores/launch-store`.
   *
   * The launch result stays tagged with its server for the reason it always
   * was: the gate takes seconds, and a result resolving after the user has
   * moved on must not be painted into a different server's panel.
   */
  const op = useLaunchStore((s) => s.op);
  const dayzUp = useLaunchStore((s) => s.dayzRunning);
  const launchResult = useLaunchStore((s) => s.result);
  const beginOp = useLaunchStore((s) => s.begin);
  const setPhase = useLaunchStore((s) => s.setPhase);
  const setNote = useLaunchStore((s) => s.setNote);
  const endOp = useLaunchStore((s) => s.end);
  const cancelOp = useLaunchStore((s) => s.cancel);
  const setLaunchResult = useLaunchStore((s) => s.setResult);
  const [modList, setModList] = useState<{ workshop_id: string; name: string }[] | null>(null);
  /**
   * The mod list is collapsed by default and is the only thing in the panel
   * that can scroll. A 93-mod server rendered inline turned the whole panel
   * into a scroll container, which pushed the stats and the JOIN button off
   * screen — the button you actually came here to press.
   */
  const [modsOpen, setModsOpen] = useState(false);
  /** workshop_id -> Steam install state. Empty when Steam isn't connected. */
  const [modStates, setModStates] = useState<Map<string, ModState>>(new Map());
  /** workshop_id -> live byte progress, only for items actively transferring. */
  const [downloads, setDownloads] = useState<
    Map<string, { downloaded: number; total: number }>
  >(new Map());
  /**
   * Unsubscribing, which stays local on purpose.
   *
   * Unlike a launch it is per-server, quick, and there is no reason to stop
   * someone doing it on one server while another is downloading.
   */
  const [unsubscribing, setUnsubscribing] = useState(false);

  /**
   * A running operation belonging to some other server.
   *
   * The working box renders for `op` whoever owns it — there is only ever one,
   * and it replaces the button, so no second launch can be started from any
   * server. This only decides whether to caption it with whose it is.
   */
  const otherOp = op && (!selectedServer || op.addr !== selectedServer.addr) ? op : null;
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmUnsub, setConfirmUnsub] = useState(false);

  useEffect(() => {
    setModList(null);
    setModsOpen(false);
    setModStates(new Map());
    setDownloads(new Map());
    setNotice(null);
    setConfirmUnsub(false);
    // Deliberately does *not* touch the running operation any more. It used to
    // cancel it, on the reasoning that the wait would otherwise launch a server
    // the user had navigated away from — but `handleVerifyAndJoin` captures its
    // address up front and launches that one regardless of what is selected
    // later. All the cancel achieved was abandoning a download the moment
    // anyone clicked another row, while Steam carried on downloading with
    // nothing on screen to say so.
  }, [selectedServer?.addr, selectedServer?.query_port]);

  /**
   * Give up on "starting" if DayZ never appears.
   *
   * The happy path ends this phase the moment the process shows up — see
   * `watchDayz`. This is the other case: a spawn that reported success and then
   * produced nothing, usually BattlEye refusing to hand off. Without it the
   * button would sit on STARTING DAYZ… forever and block every other server.
   */
  useEffect(() => {
    if (op?.phase !== "starting") return;
    const timer = window.setTimeout(() => {
      if (useLaunchStore.getState().op?.phase === "starting") endOp();
    }, LAUNCHED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [op?.phase, endOp]);

  useEffect(() => {
    if (!selectedServer) return;
    let cancelled = false;
    async function loadMods() {
      try {
        const mods = await getServerMods(selectedServer!.addr, selectedServer!.query_port);
        if (!cancelled) setModList(mods);
      } catch {
        if (!cancelled) setModList(null);
      }
    }
    loadMods();
    return () => {
      cancelled = true;
    };
  }, [selectedServer?.addr, selectedServer?.query_port]);

  // Steam install state for whatever mods the server declared. Runs off the mod
  // list rather than the selection so it can't fire before the ids are known.
  //
  // Polled rather than read once, for two reasons. Steam's `item_state` lags
  // behind the subscribe/unsubscribe callback — the callback reports success
  // before the library has actually changed — so a single read straight after a
  // mutation returns the old value and the panel looks like nothing happened.
  // Polling also makes downloads live: a mod moves not_installed -> downloading
  // -> ready without the user reselecting the server. Each poll is one local
  // call into Steam, so the cost is negligible.
  useEffect(() => {
    if (!modList || modList.length === 0) return;
    let cancelled = false;
    const ids = modList.map((m) => m.workshop_id);

    async function poll() {
      try {
        const [entries, progress] = await Promise.all([
          steamModStates(ids),
          steamDownloadProgress(ids),
        ]);
        if (cancelled) return;
        setModStates(new Map(entries.map((e) => [e.workshop_id, e.state])));
        setDownloads(
          new Map(
            progress.map((p) => [
              p.workshop_id,
              { downloaded: Number(p.downloaded), total: Number(p.total) },
            ]),
          ),
        );
      } catch (e) {
        console.error("Failed to read mod states:", e);
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), MOD_STATE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [modList]);

  if (!selectedServer) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <span className="text-xs text-[#64748b]">Select a server to view details</span>
      </div>
    );
  }

  /**
   * Spawn DayZ against a server, and record the outcome against *that* server.
   *
   * `addr` is passed in rather than read from `selectedServer` because the
   * caller captured it before a long await: the result has to be tagged with
   * the server that was actually launched, not with whatever happens to be
   * selected by the time the promise resolves.
   */
  async function launch(addr: string, gamePort: number) {
    // Its own phase, so the button can say LAUNCHING… instead of the generic
    // working state. It could not before: the whole operation was covered by
    // one spinner, so `launching` was set and cleared behind a box that never
    // rendered it — the launch step was indistinguishable from verifying.
    setPhase("launching");
    try {
      const outcome = await launchGame(addr, gamePort, launchOptions());
      setLaunchResult({ addr, message: outcome.message });
      // Handed to `starting`, which ends when DayZ shows up as a process.
      setPhase("starting");
    } catch (e) {
      // `launch_game` runs its own gate off a live re-query, so this also
      // catches a server that changed its mod list while the download ran.
      setLaunchResult({ addr, error: String(e) });
    }
  }

  /** The launch-affecting settings, in the shape {@link launchGame} wants. */
  function launchOptions() {
    return {
      profileName: profileName || undefined,
      dayzPath: dayzPath || undefined,
      launchParams: launchParams.length > 0 ? launchParams : undefined,
    };
  }

  function describeOutcome(verb: string, outcome: { succeeded: number; failures: [string, string][] }) {
    if (outcome.failures.length === 0) {
      return `${verb} ${outcome.succeeded} mod${outcome.succeeded === 1 ? "" : "s"}`;
    }
    // Name the first reason rather than just a count — "2 failed" alone gives
    // the user nothing to act on.
    const [, reason] = outcome.failures[0];
    return `${verb} ${outcome.succeeded}, ${outcome.failures.length} failed (${reason})`;
  }

  /**
   * Verify, fix, then join. The one path behind the button.
   *
   * There is deliberately no second "just launch" handler any more. The bug
   * that motivated this was a join the launcher was happy to allow: every mod
   * read as installed and current, DayZ started, and the server refused the
   * connection over an outdated mod list. Both halves of that could be stale —
   * the mod list the panel is showing, and Steam's idea of each mod's version —
   * and neither is something the user can be expected to notice, so both are
   * checked every time rather than only when something already looks wrong.
   *
   * Orchestrated here rather than as a long-running Rust command because every
   * step already exists as a proven command, and driving it from the frontend
   * makes cancellation free — the user closing the panel or hitting Cancel just
   * stops the loop.
   *
   * The wait polls Steam directly instead of reading `modStates`: that state is
   * updated by a separate effect, and reading it from inside this closure would
   * see the value captured when the loop started.
   */
  async function handleVerifyAndJoin() {
    if (!selectedServer) return;
    const addr = selectedServer.addr;
    const queryPort = selectedServer.query_port;
    const gamePort = selectedServer.game_port;

    const cancel = beginOp(addr, selectedServer.name || addr);
    // Stop the launcher probing servers while it waits on its own downloads.
    setDownloadsActive(true);
    setNotice(null);

    try {
      setPhase("verifying", "VERIFYING…");
      const verified = await verifyServerMods(addr, queryPort);
      if (cancel.cancelled) return;

      // The server is the authority on what it runs, so its answer replaces
      // whatever the registry had cached — this is the "update the details
      // page" step, and it happens before anything is subscribed so the counts
      // below are about the real list.
      setModList(verified.mods);

      // Say so when the check did not happen. The button promises verification;
      // proceeding quietly on Steam's cached opinion would be the same silence
      // that produced the bug this whole path exists to fix — the difference is
      // only that this time the launcher knows it did not look.
      if (!verified.checked_workshop) {
        setNotice({ kind: "code", code: "W01" });
      }

      const ids = verified.mods.map((m) => m.workshop_id);
      if (ids.length === 0) {
        await launch(addr, gamePort);
        return;
      }

      setPhase("verifying", "CHECKING STEAM…");
      const initial = await steamModStates(ids);
      if (cancel.cancelled) return;

      const missing = initial
        .filter((s) => s.state === "not_subscribed")
        .map((s) => s.workshop_id);
      if (missing.length > 0) {
        setPhase("subscribing", `SUBSCRIBING ${missing.length}…`);
        const outcome = await steamSubscribeMods(missing);
        if (cancel.cancelled) return;
        if (outcome.failures.length > 0) {
          const [, reason] = outcome.failures[0];
          setNotice({
            kind: "code",
            code: "E01",
            extra: `${outcome.failures.length} of ${missing.length} — ${reason}`,
          });
          return;
        }
      }

      // Steam sets the downloading bits a moment after accepting a forced
      // update, so a mod that is *about* to be replaced still reads "ready" on
      // the first poll. Without this window the loop would see nothing to wait
      // for and launch against the very content the verification just
      // condemned — the original bug, reintroduced by the fix for it.
      const settleUntil =
        verified.refreshed.length > 0 ? Date.now() + REFRESH_SETTLE_MS : 0;

      // Wait for Steam. Progress is judged by a fingerprint of every mod's
      // state plus total bytes moved; if that fingerprint stops changing for
      // FIX_STALL_MS, nothing is happening and waiting longer won't help.
      const started = Date.now();
      let lastFingerprint = "";
      let lastChange = Date.now();

      for (;;) {
        if (cancel.cancelled) return;

        const [states, progress] = await Promise.all([
          steamModStates(ids),
          steamDownloadProgress(ids),
        ]);
        if (cancel.cancelled) return;

        // Excludes server-side mods: they never become "ready", so counting
        // them here would spin until the stall detector fired.
        const notReady = states.filter((s) => isActionable(s.state) && s.state !== "ready");
        const moved = progress.reduce((n, p) => n + Number(p.downloaded), 0);
        const totalBytes = progress.reduce((n, p) => n + Number(p.total), 0);

        if (notReady.length === 0 && Date.now() >= settleUntil) break;

        const fingerprint = `${states.map((s) => s.state).join(",")}|${moved}`;
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          lastChange = Date.now();
        }

        // Kept short: this renders inside the button, in bold uppercase with
        // wide tracking, and anything longer is truncated to an ellipsis that
        // says less than a single word would have.
        setPhase(
          "downloading",
          notReady.length === 0
            ? "STARTING UPDATE…"
            : totalBytes > 0
              ? `${notReady.length} LEFT · ${formatBytes(moved, 1)} / ${formatBytes(totalBytes, 1)}`
              : `WAITING ON ${notReady.length}…`,
        );

        if (Date.now() - lastChange > FIX_STALL_MS) {
          setNotice({ kind: "code", code: "W02" });
          return;
        }
        if (Date.now() - started > FIX_DEADLINE_MS) {
          setNotice({ kind: "code", code: "W03" });
          return;
        }

        await new Promise((r) => setTimeout(r, MOD_STATE_POLL_MS));
      }

      setNote(null);

      // Whether this press turned out to involve a download the button could
      // not have predicted — either mods that had to be subscribed, or a stale
      // one the Workshop check caught that Steam had not noticed.
      const downloaded = missing.length > 0 || verified.refreshed.length > 0;

      // The one case where a press does not end in DayZ starting.
      //
      // `autoJoinAfterDownload` governs exactly this: being dropped into the
      // game on the far side of a wait. When the button said SUBSCRIBE or
      // FINISH DOWNLOADS the label already carried that; here it said JOIN,
      // because nothing visible needed doing, and the check then found
      // something. Stopping is what the setting is for, and the message names
      // what happened so pressing again is obviously the next move — the label
      // stays JOIN throughout, and the second press has nothing left to
      // download, so it joins.
      if (downloaded && !autoJoinAfterDownload) {
        setNotice({
          kind: "plain",
          text: "Mods updated — press JOIN to go in.",
        });
        return;
      }

      await launch(addr, gamePort);
    } catch (e) {
      setNotice({ kind: "plain", text: String(e) });
    } finally {
      // A launch that got as far as spawning hands the operation to `starting`,
      // which ends when DayZ appears. Ending it here would erase that in the
      // same tick.
      if (useLaunchStore.getState().op?.phase !== "starting") endOp();
      setDownloadsActive(false);
    }
  }

  async function handleUnsubscribeAll() {
    if (!modList) return;
    const ids = modList
      .map((m) => m.workshop_id)
      .filter((id) => {
        const st = modStates.get(id);
        return st !== undefined && isActionable(st) && st !== "not_subscribed";
      });
    if (ids.length === 0) return;

    setUnsubscribing(true);
    setConfirmUnsub(false);
    setNotice(null);
    try {
      const outcome = await steamUnsubscribeMods(ids);
      setNotice({ kind: "plain", text: describeOutcome("Unsubscribed from", outcome) });
    } catch (e) {
      setNotice({ kind: "plain", text: String(e) });
    } finally {
      setUnsubscribing(false);
    }
  }

  async function handleFavourite() {
    if (!selectedServer) return;
    const next = !selectedServer.favourite;
    toggleFavouriteLocal(selectedServer.addr);
    try {
      await toggleFavourite(selectedServer.addr, selectedServer.query_port, next);
    } catch (e) {
      console.error("Failed to persist favourite:", e);
      toggleFavouriteLocal(selectedServer.addr);
    }
  }

  const result =
    launchResult && launchResult.addr === selectedServer.addr ? launchResult : null;

  // `modded` comes from the info query, `mod_count`/`modList` from the rules
  // query, so a modded server legitimately sits in an "unknown yet" state.
  const knownModCount = modList?.length ?? selectedServer.mod_count;
  const summary = summarise(modStates, knownModCount ?? 0);
  const missingCount = [...modStates.values()].filter((s) => s === "not_subscribed").length;
  const subscribedCount = [...modStates.values()].filter(
    (s) => isActionable(s) && s !== "not_subscribed",
  ).length;
  /**
   * Mods that would block a launch. Only meaningful once Steam has answered —
   * an empty `modStates` means either a vanilla server or Steam not connected,
   * and in both cases the gate is the right thing to decide, not the UI.
   */
  const blockedCount = [...modStates.values()].filter(
    (s) => isActionable(s) && s !== "ready",
  ).length;
  const joinBlocked = modStates.size > 0 && blockedCount > 0;
  /**
   * Mods that are on their way in — subscribed already, just not usable yet.
   *
   * Split out from `missingCount` because the button used to be driven by
   * `joinBlocked` alone, which is one boolean covering both. Subscribing turned
   * every mod from `not_subscribed` into `downloading`, `joinBlocked` stayed
   * true throughout, and the button went on reading "SUBSCRIBE AND JOIN" while
   * Steam downloaded — describing work that was already done. Two counts, so
   * the label can say which half of the job is left.
   */
  const arrivingCount = [...modStates.values()].filter(
    (s) => s === "downloading" || s === "needs_update" || s === "not_installed",
  ).length;

  /**
   * What the button says and does next. The rule itself lives in
   * {@link joinAction} — one pure function, so the label and the behaviour are
   * read from the same place instead of being derived twice.
   */
  const action = joinAction({ missingCount, arrivingCount, autoJoinAfterDownload });

  // Aggregate transfer, summed across everything Steam is currently moving.
  // `total` is only whatever Steam has told us so far — see the note next to
  // the summary line about pre-download sizes.
  const transfer = [...downloads.values()].reduce(
    (acc, d) => ({
      downloaded: acc.downloaded + d.downloaded,
      total: acc.total + d.total,
    }),
    { downloaded: 0, total: 0 },
  );
  const readyText = selectedServer.modded
    ? knownModCount != null && knownModCount > 0
      ? `Re-reads the mod list and checks all ${knownModCount} for updates before launching`
      : "Re-reads the mod list and checks for updates before launching"
    : "Vanilla server — ready to join";

  const ping = selectedServer.ping;
  const pingColor =
    ping === null
      ? "text-[#64748b]"
      : ping > 120
        ? "text-[#ef4444]"
        : ping > 80
          ? "text-[#f59e0b]"
          : "text-[#22c55e]";

  return (
    // `overflow-hidden` + `min-h-0` on the scrolling child is what keeps the
    // panel itself from ever becoming a scroll container.
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Identity (pinned) ── */}
      <div className="shrink-0 border-b border-[#1e293b] p-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-semibold leading-tight text-[#f1f5f9]">
            {selectedServer.name}
          </h2>
          <button
            onClick={handleFavourite}
            title={selectedServer.favourite ? "Remove from favourites" : "Add to favourites"}
            aria-pressed={selectedServer.favourite}
            className={cn(
              "shrink-0 transition-colors",
              selectedServer.favourite
                ? "text-[#38bdf8] hover:text-[#7dd3fc]"
                : "text-[#334155] hover:text-[#64748b]",
            )}
          >
            <Star className="size-4" fill={selectedServer.favourite ? "currentColor" : "none"} />
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#64748b]">
          <span className="font-mono-data">{selectedServer.addr}</span>
          {selectedServer.game_port > 0 && (
            <>
              <span className="text-[#1e293b]">|</span>
              <span>game port {selectedServer.game_port}</span>
            </>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1">
          {!selectedServer.online && <Badge color="#ef4444">OFFLINE</Badge>}
          {selectedServer.official && <Badge color="#22c55e">OFFICIAL</Badge>}
          {selectedServer.first_person && <Badge color="#64748b">1PP</Badge>}
          {selectedServer.modded && <Badge color="#f59e0b">MODDED</Badge>}
          {selectedServer.locked && <Badge color="#ef4444">LOCKED</Badge>}
          {selectedServer.vac && <Badge color="#22c55e">VAC</Badge>}
          {selectedServer.battleye && <Badge color="#38bdf8">BATTLEYE</Badge>}
        </div>
      </div>

      {/* ── Live stats (pinned) ── */}
      <div className="grid shrink-0 grid-cols-4 gap-px bg-[#1e293b]">
        <StatCard
          label="PLAYERS"
          value={`${selectedServer.players}/${selectedServer.max_players}${
            selectedServer.queue != null && selectedServer.queue > 0
              ? ` +${selectedServer.queue}`
              : ""
          }`}
          color={
            !selectedServer.online
              ? "text-[#64748b]"
              : selectedServer.players >= selectedServer.max_players
                ? "text-[#f59e0b]"
                : selectedServer.players === 0
                  ? "text-[#64748b]"
                  : "text-[#f1f5f9]"
          }
        />
        <StatCard
          label="PING"
          value={selectedServer.online && ping !== null ? `${ping} ms` : "—"}
          color={selectedServer.online ? pingColor : "text-[#64748b]"}
        />
        <StatCard
          label="TIME"
          value={formatGameTime(
            selectedServer.in_game_time,
            selectedServer.day_multiplier,
            selectedServer.night_multiplier,
          )}
          color="text-[#f1f5f9]"
        />
        <StatCard
          label="MODS"
          value={knownModCount != null ? `${knownModCount}` : selectedServer.modded ? "?" : "0"}
          color={knownModCount == null && selectedServer.modded ? "text-[#f59e0b]" : "text-[#f1f5f9]"}
        />
      </div>

      {/* ── Properties (pinned) ── */}
      <div className="shrink-0 border-b border-[#1e293b] px-3 py-2">
        <InfoRow label="MAP" value={selectedServer.map_display} />
        <InfoRow label="VERSION" value={selectedServer.version || "unknown"} />
        <InfoRow label="REGION" value={regionName(selectedServer.country_code)} />
      </div>

      {/* ── Mods: collapsed by default, and the only scrollable region ── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <button
          onClick={() => setModsOpen((open) => !open)}
          disabled={!knownModCount}
          className={cn(
            "flex shrink-0 items-center gap-1.5 border-b border-[#1e293b] px-3 py-2 text-left transition-colors",
            knownModCount ? "hover:bg-[#16202e]" : "cursor-default",
          )}
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-[#64748b] transition-transform",
              modsOpen && "rotate-90",
              !knownModCount && "opacity-0",
            )}
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
            Server Mods
          </span>
          {summary && (
            <span
              className={cn(
                "ml-2 truncate text-[10px]",
                summary.tone === "ok"
                  ? "text-[#22c55e]"
                  : summary.tone === "busy"
                    ? "text-[#38bdf8]"
                    : "text-[#f59e0b]",
              )}
            >
              {summary.text}
              {transfer.total > 0 &&
                ` · ${formatBytes(transfer.downloaded, 1)} / ${formatBytes(transfer.total, 1)}`}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono-data text-[11px] text-[#94a3b8]">
            {knownModCount != null ? knownModCount : selectedServer.modded ? "?" : 0}
          </span>
        </button>

        {modsOpen && !modList && (
          <div className="px-3 py-2 text-[11px] text-[#64748b]">Loading mod list…</div>
        )}

        {modsOpen && modList && modList.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-[#64748b]">
            This server declares {selectedServer.mod_count ?? "some"} mods, but the list
            hasn't been fetched yet. Hit REFRESH to pull it.
          </div>
        )}

        {modsOpen && modList && modList.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {modList.map((mod, i) => {
              const state = modStates.get(mod.workshop_id);
              const ui = state ? MOD_STATE_UI[state] : null;
              const progress = downloads.get(mod.workshop_id);
              return (
                <div
                  key={mod.workshop_id}
                  title={ui ? `${mod.name} — ${ui.label}` : mod.name}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1",
                    i % 2 === 0 && "bg-[#0e1520]",
                  )}
                >
                  <span
                    className={cn("size-1.5 shrink-0 rounded-full", !ui && "bg-[#334155]")}
                    style={ui ? { backgroundColor: ui.dot } : undefined}
                  />
                  <span
                    className={cn("min-w-0 flex-1 truncate text-[11px]", ui?.text ?? "text-[#94a3b8]")}
                  >
                    {mod.name}
                  </span>
                  {state === "downloading" && progress ? (
                    <span className="shrink-0 font-mono-data text-[9px] tabular-nums text-[#38bdf8]">
                      {progress.total > 0
                        ? `${formatBytes(progress.downloaded, 0)} / ${formatBytes(progress.total, 0)}`
                        : formatBytes(progress.downloaded, 0)}
                    </span>
                  ) : (
                    state &&
                    state !== "ready" && (
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-[#64748b]">
                        {ui!.label}
                      </span>
                    )
                  )}
                  <span className="shrink-0 font-mono-data text-[10px] tabular-nums text-[#475569]">
                    {mod.workshop_id}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Actions (pinned) ── */}
      <div className="shrink-0 border-t border-[#1e293b] p-3">
        {notice && <NoticeLine notice={notice} />}

        {/* Precedence, and the reason for it:
            1. A running operation, *whoever it belongs to*. It is the most
               specific thing happening and the only one with a deadline.
            2. A live DayZ session, which makes every join impossible until it
               ends — one game, one process.
            3. The ordinary action.

            The first case used to be conditional on the operation being this
            server's, because it could not be anything else: switching servers
            cancelled it. Now it survives, so the panel has to be able to render
            somebody else's work. */}
        {op ? (
          <div className="flex gap-2">
            {/* `min-w-0` is load-bearing: a flex item's min-width defaults to
                its content's, so without it this box refuses to shrink below
                the width of the status line and pushes Cancel off the panel.
                `truncate` on the span cannot help — the span is not what is
                being asked to shrink. */}
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded bg-[#16202e] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#38bdf8] ring-1 ring-[#38bdf8]/30">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span className="truncate">{phaseLabel(op)}</span>
            </div>
            {/* Only while there is a wait to abandon. A spawn already handed to
                Windows is not something Cancel can take back. */}
            {op.phase !== "launching" && op.phase !== "starting" && (
              <button
                onClick={() => {
                  cancelOp();
                  setDownloadsActive(false);
                  // Steam keeps downloading; only the wait is abandoned.
                  setNotice({ kind: "code", code: "W04" });
                }}
                className="shrink-0 rounded bg-[#16202e] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] hover:text-[#ef4444]"
              >
                Cancel
              </button>
            )}
          </div>
        ) : dayzUp ? (
          <button
            disabled
            title="DayZ is running. Quit the game before joining another server."
            className="flex w-full items-center justify-center gap-2 rounded bg-[#22c55e] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#0b0f17] disabled:cursor-not-allowed disabled:opacity-100"
          >
            <Check className="size-3.5" />
            <span>PLAYING</span>
          </button>
        ) : (
          <button
            onClick={handleVerifyAndJoin}
            title={
              joinBlocked
                ? `Subscribe to what's missing, wait for Steam, then join — ${summary?.text ?? ""}`
                : action.joins
                  ? // The check still happens on every press — it is just not
                    // the button's job to say so. This is where it gets said,
                    // including the part people assume otherwise: what is
                    // compared is the server's declared list and Steam's record
                    // of each mod's version, not the bytes on disk.
                    "Re-reads the server's mod list and updates any mod the Workshop has moved past, " +
                    "then joins. Checked means Steam reports each mod installed and current — not a checksum."
                  : "Auto-join after downloading is off, so this subscribes and downloads and then stops. " +
                    "The button becomes JOIN once everything is ready."
            }
            className="flex w-full items-center justify-center gap-2 rounded bg-[#38bdf8] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#0b0f17] transition-colors hover:bg-[#7dd3fc] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action.icon === "download" ? (
              <Download className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            <span>{action.label}</span>
          </button>
        )}

        {/* Whose work the box above is showing. Only when it is not this
            server's — saying "for this server" on the server you are looking at
            is noise. */}
        {otherOp && (
          <p className="mt-2 truncate text-center text-[10px] text-[#38bdf8]">
            for {otherOp.serverName}
          </p>
        )}

        {/* Secondary, and below the primary action rather than beside it.
            Unsubscribing is destructive, shared across every server that uses
            the same mods, and something you do once in a while — it has no
            business sitting next to the button you press every session. */}
        {modStates.size > 0 && subscribedCount > 0 && !confirmUnsub && (
          <button
            onClick={() => setConfirmUnsub(true)}
            disabled={unsubscribing || op !== null}
            title="Unsubscribe from every mod this server uses"
            className="mt-2 flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] transition-colors hover:text-[#ef4444] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="size-3" />
            {unsubscribing ? "Removing…" : `Unsubscribe from ${subscribedCount} mods`}
          </button>
        )}

        {confirmUnsub && (
          <div className="mt-2 rounded border border-[#ef4444]/40 bg-[#ef4444]/5 p-2">
            <p className="text-[11px] font-semibold text-[#f1f5f9]">
              Unsubscribe from {subscribedCount} mod{subscribedCount === 1 ? "" : "s"}?
            </p>
            {/* The blast radius is wider than this server: Workshop mods are
                shared, so removing DayZ-Expansion here breaks every other
                server that uses it. Saying "93 mods" alone would understate
                it. */}
            <p className="mt-1 text-[10px] leading-relaxed text-[#94a3b8]">
              Steam will delete them from disk. Other servers that use any of these
              mods will have to download them again — this is not limited to{" "}
              {selectedServer.name}.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleUnsubscribeAll}
                className="flex-1 rounded bg-[#ef4444] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#0b0f17] hover:bg-[#f87171]"
              >
                Unsubscribe
              </button>
              <button
                onClick={() => setConfirmUnsub(false)}
                className="flex-1 rounded bg-[#16202e] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] hover:text-[#f1f5f9]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {result?.message && (
          <p className="mt-2 text-center text-[10px] text-[#22c55e]">{result.message}</p>
        )}
        {/* A refused launch used to be 10px centred red text, quieter than the
            coded warnings above the button and easy to miss entirely — the
            button simply appeared to bounce back. `launch_game` names exactly
            why it refused (DayZ path, Steam, an unreachable server, a mod it
            will not accept), and that sentence is the whole diagnosis, so it
            gets a block of its own and the full text rather than a whisper. */}
        {result?.error && (
          <div className="mt-2 rounded-md bg-[#ef4444]/10 px-3 py-2 ring-1 ring-[#ef4444]/30">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#ef4444]">
              Launch refused
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#f1f5f9]">{result.error}</p>
          </div>
        )}
        {!result && (
          <p
            className={cn(
              "mt-2 text-center text-[10px]",
              summary?.tone === "warn"
                ? "text-[#f59e0b]"
                : summary?.tone === "busy"
                  ? "text-[#38bdf8]"
                  : "text-[#64748b]",
            )}
          >
            {/* Once Steam state is known it is more useful than the generic
                "the gate will verify N mods" line, because it says whether the
                join will actually succeed. */}
            {summary && summary.tone !== "ok" ? `${summary.text} — expand SERVER MODS` : readyText}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One line under the buttons, coded when it is a problem.
 *
 * The code carries the meaning; the sentence beside it is a reminder, and the
 * full explanation is on hover. That ordering is the point — the previous
 * version put a four-line paragraph above the JOIN button, which moved the
 * button, dominated the panel, and still did not get read.
 */
function NoticeLine({ notice }: { notice: Notice }) {
  if (notice.kind === "plain") {
    return <p className="mb-2 text-center text-[10px] text-[#94a3b8]">{notice.text}</p>;
  }

  const { text, detail } = NOTICES[notice.code];
  const isError = notice.code.startsWith("E");
  return (
    <p
      title={detail}
      className={cn(
        "mb-2 flex cursor-help items-center justify-center gap-1.5 text-[10px]",
        isError ? "text-[#ef4444]" : "text-[#f59e0b]",
      )}
    >
      <span
        className={cn(
          "shrink-0 rounded px-1 font-mono-data text-[9px] font-semibold",
          isError ? "bg-[#ef4444]/15" : "bg-[#f59e0b]/15",
        )}
      >
        {notice.code}
      </span>
      <span className="truncate">
        {text}
        {notice.extra ? ` · ${notice.extra}` : ""}
      </span>
    </p>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded border px-1 text-[9px] font-semibold uppercase leading-[1.5]"
      style={{ borderColor: `${color}66`, color }}
    >
      {children}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
        {label}
      </span>
      <span className="min-w-0 truncate text-[11px] text-[#f1f5f9]">{value}</span>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#111823] p-2 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-[#64748b]">{label}</p>
      <p className={`font-mono-data text-sm font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
