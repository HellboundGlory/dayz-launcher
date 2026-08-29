/**
 * The one server-launch action path, shared by the D2 row dropdown and the M1
 * modal. Ported out of the deleted `server-details.tsx` unchanged in behaviour
 * — this is the proven verify/fix/join orchestration, and the two new surfaces
 * both drive it so a launch can never behave differently depending on where it
 * was started.
 */
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

/**
 * Short codes for anything that went sideways, in place of a paragraph.
 *
 * `W` is a warning: the join went ahead, but something was not done.
 * `E` stopped it.
 */
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

/**
 * How often the wait loop re-reads Steam install state.
 *
 * Fast enough that a subscribe or a finished download shows up promptly,
 * slow enough to be free — the underlying call is a local Steam lookup with
 * no network round trip.
 */
const MOD_STATE_POLL_MS = 1500;

/**
 * Ceiling on one subscribe-and-join. Big mod sets legitimately take a long
 * time, but the wait must end in a message rather than an indefinite spinner.
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

export function useServerActions() {
  const setDownloadsActive = useServerStore((s) => s.setDownloadsActive);
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const launchParams = useSettingsStore((s) => s.launchParams);
  const autoJoinAfterDownload = useSettingsStore((s) => s.autoJoinAfterDownload);

  const op = useLaunchStore((s) => s.op);
  const dayzUp = useLaunchStore((s) => s.dayzRunning);
  const launchResult = useLaunchStore((s) => s.result);
  const beginOp = useLaunchStore((s) => s.begin);
  const setPhase = useLaunchStore((s) => s.setPhase);
  const setNote = useLaunchStore((s) => s.setNote);
  const endOp = useLaunchStore((s) => s.end);
  const cancelOp = useLaunchStore((s) => s.cancel);

  const [notice, setNotice] = useState<Notice | null>(null);

  /**
   * Spawn DayZ against a server, and record the outcome against *that* server.
   *
   * `addr` is passed in rather than read from `selectedServer` because the
   * caller captured it before a long await: the result has to be tagged with
   * the server that was actually launched, not with whatever happens to be
   * selected by the time the promise resolves.
   */
  async function launch(addr: string, gamePort: number, toMenu = false) {
    setPhase("launching");
    try {
      const outcome = await launchGame(addr, gamePort, launchOptions(toMenu));
      useLaunchStore.getState().setResult({ addr, message: outcome.message });
      // Handed to `starting`, which ends when DayZ shows up as a process.
      setPhase("starting");
    } catch (e) {
      // `launch_game` runs its own gate off a live re-query, so this also
      // catches a server that changed its mod list while the download ran.
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

  /**
   * Verify, fix, then join. The one path behind JOIN / Load to menu.
   *
   * There is deliberately no second "just launch" handler any more. Both
   * halves of the original bug could be stale — the mod list the panel is
   * showing, and Steam's idea of each mod's version — and neither is something
   * the user can be expected to notice, so both are checked every time rather
   * than only when something already looks wrong.
   *
   * Orchestrated here rather than as a long-running Rust command because every
   * step already exists as a proven command, and driving it from the frontend
   * makes cancellation free — the user closing the panel or hitting Cancel just
   * stops the loop.
   *
   * The wait polls Steam directly instead of reading any cached state: that
   * state would be the value captured when the loop started.
   *
   * `server` is the caller's explicit target, never read from
   * `selectedServer`. The row ⋯ menu's trigger calls `stopPropagation()` so
   * opening it does not select that row, and the M1 modal shows whatever
   * server it was opened for regardless of the table's selection — either one
   * reading the global selection could run this whole gate, and a real join,
   * against a different server than the button the user pressed.
   */
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

      // Say so when the check did not happen. The button promises verification;
      // proceeding quietly on Steam's cached opinion would be the same silence
      // that produced the bug this whole path exists to fix.
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

      // Steam sets the downloading bits a moment after accepting a forced
      // update, so a mod that is *about* to be replaced still reads "ready" on
      // the first poll. Without this window the loop would see nothing to wait
      // for and launch against the very content the verification just
      // condemned.
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
      // `autoJoinAfterDownload` governs exactly this: being dropped into the
      // game on the far side of a wait.
      if (downloaded && !autoJoinAfterDownload) {
        setNotice({ kind: "plain", text: "Mods updated — press JOIN to go in." });
        return;
      }

      await launch(addr, gamePort, toMenu);
    } catch (e) {
      setNotice({ kind: "plain", text: String(e) });
    } finally {
      // Only touch shared state if this is still the operation the store is
      // tracking. `cancel` is the identity token `beginOp` minted for this
      // call; a mismatch means `cancelWait` already cleared it, or — worse —
      // a later press started a new operation while this one was still
      // resolving. Without this check, a cancelled or superseded press could
      // wipe a newer operation's progress box and re-enable A2S probing
      // mid-download the moment its own abandoned promise finally settled.
      if (useLaunchStore.getState().op?.cancel === cancel) {
        // A launch that got as far as spawning hands the operation to `starting`,
        // which ends when DayZ appears. Ending it here would erase that in the
        // same tick.
        if (useLaunchStore.getState().op?.phase !== "starting") endOp();
        setDownloadsActive(false);
      }
    }
  }

  /**
   * Subscribe the server's missing mods and let Steam download them — no join.
   *
   * The D2 dropdown's "Download mods" action. Re-uses the verification so the
   * list being subscribed is the server's live declaration, then subscribes
   * anything not already subscribed and reports what happened.
   *
   * `server` is the caller's explicit target — see `verifyAndJoin`'s doc for
   * why this must never fall back to the table's selection.
   */
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
      // See the matching guard in `verifyAndJoin` — a cancelled or superseded
      // press must not tear down whatever operation replaced it.
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

  // Give up on "starting" if DayZ never appears (usually BattlEye refusing to
  // hand off). Without it the button would sit on STARTING DAYZ… forever and
  // block every other server. Lives here so both surfaces inherit it.
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
