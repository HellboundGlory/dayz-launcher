import { create } from "zustand";
import { scanLan } from "@/lib/tauri";
import { useServerStore } from "./server-store";

export type LanScanState = "idle" | "scanning" | "done" | "failed";

interface LanState {
  state: LanScanState;
  /** The addresses the last scan found; kept when a later scan fails. */
  addrs: string[];
  /** Looks for servers on the networks this PC is on. A second call while one runs does nothing. */
  scan: () => Promise<void>;
}

/** Whether the list is showing the LAN tab, read off the filter it was given. */
function onLanTab(): boolean {
  return useServerStore.getState().filter.lan_addrs !== null;
}

function sameAddrs(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((addr, i) => addr === b[i]);
}

export const useLanStore = create<LanState>()((set, get) => ({
  state: "idle",
  addrs: [],
  scan: async () => {
    if (get().state === "scanning") return;
    set({ state: "scanning" });
    try {
      const reply: unknown = await scanLan();
      if (!Array.isArray(reply)) throw new Error("scan_lan returned no list");
      const addrs = reply.filter((a): a is string => typeof a === "string");
      const same = sameAddrs(addrs, get().addrs);
      set({ state: "done", addrs });
      // A scan can land after the player left the tab; that reply must not drag the list back.
      // The same addresses again would only reload the rows and make them flicker.
      if (onLanTab() && !same) useServerStore.getState().setFilter({ lan_addrs: addrs });
    } catch {
      set({ state: "failed" });
    }
  },
}));
