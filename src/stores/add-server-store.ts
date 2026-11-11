import { create } from "zustand";
import { findServer, toggleFavourite } from "@/lib/tauri";
import { useServerStore } from "./server-store";
import type { Server } from "@/types/server";

/** A lookup starts this long after the last keystroke, or at once on Enter. */
export const LOOKUP_DELAY_MS = 700;

export type AddServerState = "idle" | "searching" | "notFound" | "error" | "found";

interface AddServerStore {
  open: boolean;
  input: string;
  state: AddServerState;
  server: Server | null;
  /** The command's message for `error`, or why a favourite write failed. */
  message: string | null;
  /** True while the favourite write is in flight. */
  busy: boolean;
  show: () => void;
  close: () => void;
  /** Replaces the typed text and restarts (or cancels) the wait for it to settle. */
  type: (text: string) => void;
  /** Asks at once, whatever the wait was. */
  submit: () => void;
  /** Saves the found server and closes; a refused write undoes the optimistic change. */
  favourite: () => Promise<void>;
}

/** Whether the typed text is worth a lookup: something, and no spaces. */
export function lookupReady(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let newest = 0;

function clearTimer() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}

const INITIAL = {
  open: false,
  input: "",
  state: "idle" as AddServerState,
  server: null,
  message: null,
  busy: false,
};

/** The Add server dialog's own state: what is typed, what the last lookup found. */
export const useAddServerStore = create<AddServerStore>()((set, get) => {
  const look = (text: string) => {
    clearTimer();
    // Each lookup owns an id; a reply for older input is dropped.
    const id = ++newest;
    set({ state: "searching", message: null });
    findServer(text).then(
      (found) => {
        if (id !== newest) return;
        set(found ? { server: found, state: "found" } : { server: null, state: "notFound" });
      },
      (e: unknown) => {
        if (id !== newest) return;
        set({ server: null, message: String(e), state: "error" });
      },
    );
  };

  return {
    ...INITIAL,
    show: () =>
      set({ ...INITIAL, open: true }),
    close: () => {
      clearTimer();
      newest++;
      set({ open: false, busy: false });
    },
    type: (text) => {
      clearTimer();
      // Nothing reaches the backend until the typing settles.
      newest++;
      set({ input: text, server: null, message: null, state: "idle" });
      if (!lookupReady(text)) return;
      timer = setTimeout(() => {
        timer = undefined;
        look(text);
      }, LOOKUP_DELAY_MS);
    },
    submit: () => {
      const text = get().input;
      if (!lookupReady(text) || get().state === "searching") return;
      look(text);
    },
    favourite: async () => {
      const target = get().server;
      if (!target) return;
      set({ busy: true });
      // Optimistic, so the row and the button react at once; undone if the write fails.
      useServerStore.getState().toggleFavourite(target.addr);
      try {
        await toggleFavourite(target.addr, target.query_port, true);
        get().close();
      } catch (e) {
        console.error("Failed to save favourite:", e);
        useServerStore.getState().toggleFavourite(target.addr);
        set({ busy: false, message: `Couldn't add it to Favourites: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
  };
});
