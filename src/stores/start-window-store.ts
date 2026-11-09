import { create } from "zustand";
import type { ActiveOp } from "@/stores/launch-store";

/** The op's identity token — the one thing that says whether a window still belongs to it. */
type OpToken = ActiveOp["cancel"];

interface StartWindowState {
  /** The op this window was opened for, or null when none is showing. */
  forOp: OpToken | null;
  /** A "Load to menu" join renames its last step. */
  toMenu: boolean;
  hidden: boolean;
  stepIndex: number;
  /** When the current step began, for the elapsed time beside it. */
  stepSince: number;
  /** What the slow note counts from: the step's start, or the download note's last change. */
  slowSince: number;
  /** The note the current step has shown so far — a new one restarts the clock on the download step. */
  stepNote: string | null;
  show: (op: OpToken, toMenu: boolean, keepHidden: boolean) => void;
  hide: () => void;
  noteStep: (index: number, now: number, note?: string | null) => void;
  close: () => void;
}

/** Backs the one launcher-owned window listing a join's steps. */
export const useStartWindowStore = create<StartWindowState>((set, get) => ({
  forOp: null,
  toMenu: false,
  hidden: false,
  stepIndex: 0,
  stepSince: 0,
  slowSince: 0,
  stepNote: null,

  show: (forOp, toMenu, keepHidden) =>
    set({
      forOp,
      toMenu,
      hidden: keepHidden ? get().hidden : false,
      stepIndex: 0,
      stepSince: Date.now(),
      slowSince: Date.now(),
      stepNote: null,
    }),

  hide: () => set({ hidden: true }),

  noteStep: (index, now, note = null) => {
    const { stepIndex, stepNote } = get();
    if (index !== stepIndex) {
      set({ stepIndex: index, stepSince: now, slowSince: now, stepNote: note });
    } else if (note !== stepNote) {
      // A moving download isn't slow; only the slow count restarts.
      set({ slowSince: now, stepNote: note });
    }
  },

  close: () => set({ forOp: null, hidden: false, stepIndex: 0, stepSince: 0, slowSince: 0, stepNote: null }),
}));
