import { create } from "zustand";
import { dayzRunning } from "@/lib/tauri";

/**
 * The one launch-or-prepare operation the launcher is running, app-wide.
 *
 * ## Why this is not component state
 *
 * All of it used to live in `server-details.tsx`, and an effect keyed on the
 * selected server reset it — *including cancelling the in-flight work*. So
 * clicking another server part-way through a 4 GB download silently abandoned
 * the wait, and clicking back showed a button that had forgotten there was
 * anything happening. Steam kept downloading either way, which made it worse:
 * the work continued and the only indication of it disappeared.
 *
 * There is deliberately room for exactly one operation. Steam has one download
 * queue and the machine runs one DayZ, so a second concurrent launch is not a
 * thing to represent — it is a thing to prevent.
 */

/** How far along the one operation is. */
export type OpPhase =
  | "verifying"
  | "subscribing"
  | "downloading"
  /** `launch_game` is in flight — its gate re-queries the server before spawning. */
  | "launching"
  /** DayZ has been spawned but has not yet appeared as a process. */
  | "starting";

export interface ActiveOp {
  /** The server this belongs to, as `IP:query_port`. */
  addr: string;
  /** For the line telling the user which server is busy when they look at another. */
  serverName: string;
  phase: OpPhase;
  /** Live detail under the phase, e.g. `3 LEFT · 1.2 GB / 4.0 GB`. */
  note: string | null;
  /** Flipped to abandon the wait from outside the loop driving it. */
  cancel: { cancelled: boolean };
}

/** The outcome of the last launch, tagged with the server it belongs to. */
export interface LaunchResult {
  addr: string;
  message?: string;
  error?: string;
}

interface LaunchState {
  op: ActiveOp | null;
  result: LaunchResult | null;
  /**
   * A DayZ process exists right now.
   *
   * Polled from the OS rather than inferred from having launched one, so it is
   * also true for a session started from Steam directly, and stays true across
   * the launcher being closed and reopened. This is what lets the button read
   * PLAYING instead of counting down from a spawn.
   */
  dayzRunning: boolean;
  begin: (addr: string, serverName: string) => { cancelled: boolean };
  setPhase: (phase: OpPhase, note?: string | null) => void;
  setNote: (note: string | null) => void;
  end: () => void;
  cancel: () => void;
  setResult: (result: LaunchResult | null) => void;
  setDayzRunning: (running: boolean) => void;
}

export const useLaunchStore = create<LaunchState>((set, get) => ({
  op: null,
  result: null,
  dayzRunning: false,

  begin: (addr, serverName) => {
    const cancel = { cancelled: false };
    set({
      op: { addr, serverName, phase: "verifying", note: null, cancel },
      result: null,
    });
    return cancel;
  },

  setPhase: (phase, note = null) => {
    const { op } = get();
    if (!op) return;
    set({ op: { ...op, phase, note } });
  },

  setNote: (note) => {
    const { op } = get();
    if (!op) return;
    set({ op: { ...op, note } });
  },

  end: () => set({ op: null }),

  cancel: () => {
    const { op } = get();
    // Flip the flag the loop reads *before* dropping the op, or the loop's next
    // check reads a stale `false` and carries on into a launch.
    if (op) op.cancel.cancelled = true;
    set({ op: null });
  },

  setResult: (result) => set({ result }),

  setDayzRunning: (running) => {
    if (get().dayzRunning === running) return;
    set({ dayzRunning: running });
  },
}));

/** How often the OS is asked whether DayZ is running. */
export const DAYZ_POLL_MS = 4_000;

/**
 * Keep {@link LaunchState.dayzRunning} current. Started once, from `App`.
 *
 * Returns its own teardown so the caller can hand it straight to `useEffect`.
 * Polling continuously rather than only after a launch is what makes the state
 * honest about a session this launcher did not start.
 */
export function watchDayz(): () => void {
  let stopped = false;

  async function poll() {
    try {
      const running = await dayzRunning();
      if (stopped) return;
      const store = useLaunchStore.getState();
      store.setDayzRunning(running);
      // The game appearing is the end of the launch, and a better signal than
      // the timer this replaces: the old code held a "DayZ is starting"
      // confirmation for a fixed 15 seconds whether or not anything started.
      if (running && store.op?.phase === "starting") store.end();
    } catch {
      // A failed process query says nothing about whether DayZ is running, so
      // the last known answer stands rather than being reset to false.
    }
  }

  void poll();
  const timer = window.setInterval(() => void poll(), DAYZ_POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
