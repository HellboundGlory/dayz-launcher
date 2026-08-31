import { create } from "zustand";
import { dayzRunning } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";

// The one launch-or-prepare operation the launcher is running, app-wide.
// Global rather than component state so switching the selected server can't
// cancel an in-flight download. Room for exactly one: Steam has one download
// queue and the machine runs one DayZ.

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
  /** A DayZ process exists right now — polled from the OS, so true even for a session started outside the launcher. */
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

/** Keeps {@link LaunchState.dayzRunning} current; returns its teardown for useEffect. */
export function watchDayz(): () => void {
  function apply(running: boolean) {
    const store = useLaunchStore.getState();
    store.setDayzRunning(running);
    // The game appearing is what ends the "starting" phase.
    if (running && store.op?.phase === "starting") store.end();
  }

  dayzRunning().then(apply).catch(() => {
    // A failed process query says nothing about whether DayZ is running, so
    // the last known answer stands rather than being reset to false.
  });

  const pending = listen<boolean>("dayz-running", (event) => apply(event.payload));
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}
