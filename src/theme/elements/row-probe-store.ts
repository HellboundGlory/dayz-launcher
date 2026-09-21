import { create } from "zustand";

export function probeKey(addr: string, queryPort: number): string {
  return `${addr}:${queryPort}`;
}

interface RowProbeState {
  /** The one row currently re-probing, app-wide, or null when idle. */
  probingKey: string | null;
  startProbe: (addr: string, queryPort: number) => void;
  endProbe: (addr: string, queryPort: number) => void;
}

export const useRowProbeStore = create<RowProbeState>((set, get) => ({
  probingKey: null,
  startProbe: (addr, queryPort) => set({ probingKey: probeKey(addr, queryPort) }),
  endProbe: (addr, queryPort) => {
    // Only clear if this call's probe is still the current one — a stale
    // finally() from a superseded probe must not erase a newer one.
    if (get().probingKey === probeKey(addr, queryPort)) set({ probingKey: null });
  },
}));
