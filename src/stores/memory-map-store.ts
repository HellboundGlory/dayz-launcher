import { create } from "zustand";
import type { MemoryMapStatus } from "@/lib/tauri";

export interface MemoryMapAnswer {
  join: boolean;
  dontWarn: boolean;
}

interface MemoryMapState {
  request: { status: MemoryMapStatus } | null;
  ask: (status: MemoryMapStatus) => Promise<MemoryMapAnswer>;
  answer: (join: boolean, dontWarn: boolean) => void;
}

// The resolver stays out of the state: it is not rendered, and a second ask
// has to settle the first before a render happens.
let pending: ((answer: MemoryMapAnswer) => void) | null = null;

/** Backs the one launcher-owned memory map warning. */
export const useMemoryMapStore = create<MemoryMapState>((set) => ({
  request: null,
  ask: (status) => {
    pending?.({ join: false, dontWarn: false });
    return new Promise<MemoryMapAnswer>((resolve) => {
      pending = resolve;
      set({ request: { status } });
    });
  },
  answer: (join, dontWarn) => {
    const resolve = pending;
    pending = null;
    set({ request: null });
    resolve?.({ join, dontWarn });
  },
}));
