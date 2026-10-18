import { create } from "zustand";
import type { Server } from "@/types/server";

export type OverlayId = "serverInfo" | "modFilter" | "update" | "settings";

export interface Overlay {
  id: OverlayId;
  /** The server the info modal shows. */
  payload?: Server;
}

interface OverlayState {
  /** Open overlays, oldest first. */
  stack: Overlay[];
  /** Reopening an open overlay moves it to the top with the new payload. */
  open: (id: OverlayId, payload?: Server) => void;
  /** Closes the named overlay, or the top one when no id is given. */
  close: (id?: OverlayId) => void;
  top: () => Overlay | undefined;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  stack: [],
  open: (id, payload) =>
    set((s) => ({ stack: [...s.stack.filter((o) => o.id !== id), { id, payload }] })),
  close: (id) =>
    set((s) => ({
      stack: id === undefined ? s.stack.slice(0, -1) : s.stack.filter((o) => o.id !== id),
    })),
  top: () => {
    const { stack } = get();
    return stack[stack.length - 1];
  },
}));
