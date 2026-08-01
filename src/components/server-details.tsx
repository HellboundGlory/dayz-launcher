import { useEffect, useRef, useState } from "react";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Play, ChevronRight, Star, Download, Trash2, Loader2 } from "lucide-react";
import {
  launchGame,
  getServerMods,
  toggleFavourite,
  steamModStates,
  steamDownloadProgress,
  steamSubscribeMods,
  steamUnsubscribeMods,
  type ModState,
} from "@/lib/tauri";
import { cn, formatBytes, regionName } from "@/lib/utils";

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
  const [launching, setLaunching] = useState(false);
  /**
   * The launch outcome, tagged with the server it belongs to.
   *
   * A bare message string leaked across selections: `handleJoin` awaits the
   * whole mod gate (live A2S_RULES + Workshop checks + spawn), and if the user
   * picked a different server while that was in flight, the resolving promise
   * wrote the old server's result into the new server's panel. Clearing on
   * selection change can't fix that — the write happens after the clear.
   * Tagging it does, because rendering is then conditional on the address
   * still matching, regardless of when the promise lands.
   */
  const [launchResult, setLaunchResult] = useState<
    { addr: string; message?: string; error?: string } | null
  >(null);
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
  /** Which batched Steam operation is in flight, if any. */
  const [busy, setBusy] = useState<null | "subscribe" | "unsubscribe" | "fixing">(null);
  /** Live status line while subscribe-and-join waits on Steam. */
  const [fixNote, setFixNote] = useState<string | null>(null);
  /** Lets the in-flight subscribe-and-join loop be stopped from outside it. */
  const fixCancel = useRef<{ cancelled: boolean } | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [confirmUnsub, setConfirmUnsub] = useState(false);

  useEffect(() => {
    setModList(null);
    setModsOpen(false);
    setModStates(new Map());
    setDownloads(new Map());
    setActionNote(null);
    setConfirmUnsub(false);
    setFixNote(null);
    // Abandon any subscribe-and-join still waiting on the previous server,
    // otherwise it would launch a server the user has navigated away from.
    if (fixCancel.current) fixCancel.current.cancelled = true;
    setBusy(null);
  }, [selectedServer?.addr, selectedServer?.query_port]);

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

  async function handleJoin() {
    if (!selectedServer) return;
    // Captured before the await so the result is tagged with the server that
    // was actually launched, not whatever happens to be selected on resolve.
    const addr = selectedServer.addr;
    const gamePort = selectedServer.game_port;
    setLaunching(true);
    setLaunchResult(null);
    try {
      const outcome = await launchGame(addr, gamePort, launchOptions());
      setLaunchResult({ addr, message: outcome.message });
    } catch (e) {
      setLaunchResult({ addr, error: String(e) });
    } finally {
      setLaunching(false);
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
   * Subscribe to whatever is missing, wait for Steam to finish, then join.
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
  async function handleSubscribeAndJoin() {
    if (!modList || modList.length === 0) return;
    const addr = selectedServer!.addr;
    const gamePort = selectedServer!.game_port;
    const ids = modList.map((m) => m.workshop_id);

    const cancel = { cancelled: false };
    fixCancel.current = cancel;
    setBusy("fixing");
    // Stop the launcher probing servers while it waits on its own downloads.
    setDownloadsActive(true);
    setActionNote(null);
    setLaunchResult(null);

    try {
      const missing = ids.filter((id) => modStates.get(id) === "not_subscribed");
      if (missing.length > 0) {
        setFixNote(`Subscribing to ${missing.length} mod${missing.length === 1 ? "" : "s"}…`);
        const outcome = await steamSubscribeMods(missing);
        if (outcome.failures.length > 0) {
          const [, reason] = outcome.failures[0];
          setActionNote(`Could not subscribe to ${outcome.failures.length} mod(s): ${reason}`);
          return;
        }
      }

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

        if (notReady.length === 0) break;

        const fingerprint = `${states.map((s) => s.state).join(",")}|${moved}`;
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          lastChange = Date.now();
        }

        setFixNote(
          totalBytes > 0
            ? `${notReady.length} remaining · ${formatBytes(moved, 1)} / ${formatBytes(totalBytes, 1)}`
            : `Waiting on ${notReady.length} mod${notReady.length === 1 ? "" : "s"}…`,
        );

        if (Date.now() - lastChange > FIX_STALL_MS) {
          setActionNote(
            "Downloads have stalled — nothing has progressed for a few minutes. " +
              "Steam pauses Workshop downloads during gameplay by default, and it sees " +
              "this launcher as DayZ. Enable Steam → Settings → Downloads → " +
              "'Allow downloads during gameplay'.",
          );
          return;
        }
        if (Date.now() - started > FIX_DEADLINE_MS) {
          setActionNote("Gave up waiting for downloads after 45 minutes.");
          return;
        }

        await new Promise((r) => setTimeout(r, MOD_STATE_POLL_MS));
      }

      setFixNote(null);

      if (!autoJoinAfterDownload) {
        setActionNote("All mods ready — press JOIN SERVER when you are.");
        return;
      }

      setLaunching(true);
      try {
        const outcome = await launchGame(addr, gamePort, launchOptions());
        setLaunchResult({ addr, message: outcome.message });
      } catch (e) {
        // The gate re-queries the server live, so this also catches the case
        // where the server changed its mod list while the download ran.
        setLaunchResult({ addr, error: String(e) });
      } finally {
        setLaunching(false);
      }
    } catch (e) {
      setActionNote(String(e));
    } finally {
      setFixNote(null);
      setBusy(null);
      setDownloadsActive(false);
      fixCancel.current = null;
    }
  }

  async function handleSubscribeAll() {
    if (!modList) return;
    // Only the ones that need it; re-subscribing to a ready mod is wasted work.
    const ids = modList
      .map((m) => m.workshop_id)
      .filter((id) => modStates.get(id) === "not_subscribed");
    if (ids.length === 0) return;

    setBusy("subscribe");
    setActionNote(null);
    try {
      const outcome = await steamSubscribeMods(ids);
      setActionNote(describeOutcome("Subscribed to", outcome));
      // The polling effect picks up the new state; Steam lags the callback, so
      // reading it here would often return the pre-mutation value anyway.
    } catch (e) {
      setActionNote(String(e));
    } finally {
      setBusy(null);
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

    setBusy("unsubscribe");
    setConfirmUnsub(false);
    setActionNote(null);
    try {
      const outcome = await steamUnsubscribeMods(ids);
      setActionNote(describeOutcome("Unsubscribed from", outcome));
    } catch (e) {
      setActionNote(String(e));
    } finally {
      setBusy(null);
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
      ? `Mod gate will verify ${knownModCount} Workshop mod${knownModCount === 1 ? "" : "s"} before launch`
      : "Mod gate will verify Workshop mods before launch"
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
          value={`${selectedServer.players}/${selectedServer.max_players}`}
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
          value={selectedServer.in_game_time ?? "--:--"}
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
        {/* Workshop actions. Hidden entirely for vanilla servers and while
            Steam state is unknown, where they'd be no-ops. */}
        {modStates.size > 0 && (
          <div className="mb-2 flex gap-2">
            <button
              onClick={handleSubscribeAll}
              disabled={busy !== null || missingCount === 0}
              title={
                missingCount === 0
                  ? "Every mod this server uses is already subscribed"
                  : `Subscribe to ${missingCount} missing mod${missingCount === 1 ? "" : "s"} and start downloading`
              }
              className="flex flex-1 items-center justify-center gap-1 rounded bg-[#16202e] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] transition-colors hover:text-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="size-3" />
              {busy === "subscribe"
                ? "Subscribing…"
                : missingCount > 0
                  ? `Subscribe ${missingCount}`
                  : "Subscribe all"}
            </button>

            <button
              onClick={() => setConfirmUnsub(true)}
              disabled={busy !== null || subscribedCount === 0}
              title="Unsubscribe from every mod this server uses"
              className="flex items-center justify-center gap-1 rounded bg-[#16202e] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] ring-1 ring-[#1e293b] transition-colors hover:text-[#ef4444] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="size-3" />
              {busy === "unsubscribe" ? "Removing…" : "Unsubscribe"}
            </button>
          </div>
        )}

        {confirmUnsub && (
          <div className="mb-2 rounded border border-[#ef4444]/40 bg-[#ef4444]/5 p-2">
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

        {actionNote && (
          <p className="mb-2 text-center text-[10px] text-[#94a3b8]">{actionNote}</p>
        )}

        {/* When mods are missing the button becomes the fix-and-join action
            rather than a dead end — greying it out told the user what was wrong
            but gave them nothing to press. */}
        {busy === "fixing" ? (
          <div className="flex gap-2">
            <div className="flex flex-1 items-center justify-center gap-2 rounded bg-[#16202e] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#38bdf8] ring-1 ring-[#38bdf8]/30">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="truncate">{fixNote ?? "Working…"}</span>
            </div>
            <button
              onClick={() => {
                if (fixCancel.current) fixCancel.current.cancelled = true;
                setBusy(null);
                setFixNote(null);
                setDownloadsActive(false);
                // Steam keeps downloading; only the wait is abandoned.
                setActionNote("Stopped waiting. Downloads continue in Steam.");
              }}
              className="rounded bg-[#16202e] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] hover:text-[#ef4444]"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={joinBlocked ? handleSubscribeAndJoin : handleJoin}
            disabled={launching || busy !== null}
            title={
              joinBlocked
                ? `Subscribe to what's missing, wait for Steam, then join — ${summary?.text ?? ""}`
                : "Verify mods and join this server"
            }
            className="flex w-full items-center justify-center gap-2 rounded bg-[#38bdf8] px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#0b0f17] transition-colors hover:bg-[#7dd3fc] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joinBlocked ? <Download className="size-3.5" /> : <Play className="size-3.5" />}
            <span>
              {launching
                ? "LAUNCHING..."
                : joinBlocked
                  ? "SUBSCRIBE AND JOIN"
                  : "JOIN SERVER"}
            </span>
          </button>
        )}

        {result?.message && (
          <p className="mt-2 text-center text-[10px] text-[#22c55e]">{result.message}</p>
        )}
        {result?.error && (
          <p className="mt-2 text-center text-[10px] text-[#ef4444]">{result.error}</p>
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
