// Shared launch action path used by the row dropdown and the info modal.
import { useEffect, useState } from "react";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useLaunchStore, type ActiveOp } from "@/stores/launch-store";
import {
  launchGame,
  verifyServerMods,
  steamModStates,
  steamDownloadProgress,
  steamSubscribeMods,
  type ModState,
} from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import type { Server } from "@/types/server";

/** Short codes for anything that went sideways. `W` = join went ahead anyway, `E` = stopped it. */
export const NOTICES = {
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

export type NoticeCode = keyof typeof NOTICES;

/** How often the wait loop re-reads Steam install state (a cheap local lookup). */
const MOD_STATE_POLL_MS = 1500;

/** Ceiling on one subscribe-and-join — must end in a message, not an infinite spinner. */
const FIX_DEADLINE_MS = 45 * 60 * 1000;

/** No progress for this long (state + bytes both unchanged) counts as stalled. */
const FIX_STALL_MS = 3 * 60 * 1000;

/** How long the JOIN button holds its "DayZ is starting" confirmation. */
const LAUNCHED_NOTICE_MS = 15_000;

// Grace period after forcing an update before trusting an "all ready" reading —
// Steam's state bits lag a moment behind accepting the download request.
const REFRESH_SETTLE_MS = 5_000;

/** A line under the buttons: either a coded problem or a plain result. */
export type Notice =
  | { kind: "code"; code: NoticeCode; extra?: string }
  | { kind: "plain"; text: string };

/** What the working box reads while an operation runs. */
export function phaseLabel(op: ActiveOp): string {
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

// Excludes not_on_workshop mods — they have no Workshop id and can never
// become "ready", so counting them as blockers made those servers unjoinable.
function isActionable(state: ModState) {
  return state !== "not_on_workshop";
}

export function useServerActions() {
  const setDownloadsActive = useServerStore((s) => s.setDownloadsActive);
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const launchParams = useSettingsStore((s) => s.launchParams);

  const op = useLaunchStore((s) => s.op);
  const dayzUp = useLaunchStore((s) => s.dayzRunning);
  const launchResult = useLaunchStore((s) => s.result);
  const beginOp = useLaunchStore((s) => s.begin);
  const setPhase = useLaunchStore((s) => s.setPhase);
  const setNote = useLaunchStore((s) => s.setNote);
  const endOp = useLaunchStore((s) => s.end);
  const cancelOp = useLaunchStore((s) => s.cancel);

  const [notice, setNotice] = useState<Notice | null>(null);

  // `addr` is passed in rather than read from `selectedServer`, so the result
  // is tagged with the server actually launched, not whatever's selected once
  // the promise resolves.
  async function launch(addr: string, gamePort: number, toMenu = false) {
    setPhase("launching");
    try {
      const outcome = await launchGame(addr, gamePort, launchOptions(toMenu));
      useLaunchStore.getState().setResult({ addr, message: outcome.message });
      setPhase("starting");
    } catch (e) {
      useLaunchStore.getState().setResult({ addr, error: String(e) });
    }
  }

  /** The launch-affecting settings, in the shape {@link launchGame} wants. */
  function launchOptions(toMenu: boolean) {
    return {
      profileName: profileName || undefined,
      dayzPath: dayzPath || undefined,
      launchParams: launchParams.length > 0 ? launchParams : undefined,
      mainMenu: toMenu || undefined,
    };
  }

  // Verify, fix, then join — the one path behind JOIN / Load to menu.
  // `server` is always the caller's explicit target, never the table's
  // global selection (which can differ from the row/modal that was clicked).
  async function verifyAndJoin(server: Server, toMenu = false) {
    const addr = server.addr;
    const queryPort = server.query_port;
    const gamePort = server.game_port;

    const cancel = beginOp(addr, server.name || addr);
    // Stop the launcher probing servers while it waits on its own downloads.
    setDownloadsActive(true);
    setNotice(null);

    try {
      setPhase("verifying", "VERIFYING…");
      const verified = await verifyServerMods(addr, queryPort);
      if (cancel.cancelled) return;

      // Flag it rather than silently proceeding on Steam's cached opinion.
      if (!verified.checked_workshop) {
        setNotice({ kind: "code", code: "W01" });
      }

      const ids = verified.mods.map((m) => m.workshop_id);
      if (ids.length === 0) {
        await launch(addr, gamePort, toMenu);
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

      // A mod about to be replaced still reads "ready" for a moment — give
      // Steam time to flip the downloading bits before trusting a clean read.
      const settleUntil =
        verified.refreshed.length > 0 ? Date.now() + REFRESH_SETTLE_MS : 0;

      // Progress is a fingerprint of state + bytes moved; no change for
      // FIX_STALL_MS means nothing is happening.
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

        const notReady = states.filter((s) => isActionable(s.state) && s.state !== "ready");
        const moved = progress.reduce((n, p) => n + Number(p.downloaded), 0);
        const totalBytes = progress.reduce((n, p) => n + Number(p.total), 0);

        if (notReady.length === 0 && Date.now() >= settleUntil) break;

        const fingerprint = `${states.map((s) => s.state).join(",")}|${moved}`;
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          lastChange = Date.now();
        }

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

      await launch(addr, gamePort, toMenu);
    } catch (e) {
      setNotice({ kind: "plain", text: String(e) });
    } finally {
      // `cancel` is this call's identity token — a mismatch means a newer
      // operation replaced this one, so leave its state alone.
      if (useLaunchStore.getState().op?.cancel === cancel) {
        // A launch that reached spawning hands off to `starting`; don't erase that.
        if (useLaunchStore.getState().op?.phase !== "starting") endOp();
        setDownloadsActive(false);
      }
    }
  }

  // Subscribes the server's missing mods and lets Steam download them — no join.
  async function subscribeOnly(server: Server) {
    const addr = server.addr;
    const queryPort = server.query_port;

    const cancel = beginOp(addr, server.name || addr);
    setDownloadsActive(true);
    setNotice(null);

    try {
      setPhase("verifying", "VERIFYING…");
      const verified = await verifyServerMods(addr, queryPort);
      if (cancel.cancelled) return;

      const ids = verified.mods.map((m) => m.workshop_id);
      if (ids.length === 0) {
        setNotice({ kind: "plain", text: "This server uses no mods." });
        return;
      }

      setPhase("subscribing", "CHECKING STEAM…");
      const initial = await steamModStates(ids);
      if (cancel.cancelled) return;

      const missing = initial
        .filter((s) => s.state === "not_subscribed")
        .map((s) => s.workshop_id);
      if (missing.length === 0) {
        const updating = verified.refreshed.length;
        setNotice({
          kind: "plain",
          text:
            updating > 0
              ? `${updating} mod${updating === 1 ? "" : "s"} updating — Steam is downloading them.`
              : "All mods are already subscribed and installed.",
        });
        return;
      }

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
      setNotice({
        kind: "plain",
        text: `${missing.length} mod${missing.length === 1 ? "" : "s"} subscribed — Steam is downloading them in the background.`,
      });
    } catch (e) {
      setNotice({ kind: "plain", text: String(e) });
    } finally {
      // See the matching guard in verifyAndJoin.
      if (useLaunchStore.getState().op?.cancel === cancel) {
        endOp();
        setDownloadsActive(false);
      }
    }
  }

  /** Abandon a wait (downloads continue in Steam). */
  function cancelWait() {
    cancelOp();
    setDownloadsActive(false);
    setNotice({ kind: "code", code: "W04" });
  }

  // Give up on "starting" if DayZ never appears (usually BattlEye refusing to hand off).
  useEffect(() => {
    if (op?.phase !== "starting") return;
    const timer = window.setTimeout(() => {
      if (useLaunchStore.getState().op?.phase === "starting") endOp();
    }, LAUNCHED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [op?.phase, endOp]);

  return {
    op,
    dayzUp,
    launchResult,
    notice,
    setNotice,
    verifyAndJoin,
    subscribeOnly,
    cancelWait,
    phaseLabel,
    NOTICES,
  };
}
