import { create } from "zustand";
import { refreshVisibleServers } from "@/lib/tauri";

export function probeKey(addr: string, queryPort: number): string {
  return `${addr}:${queryPort}`;
}

/** The row-probe controls a caller reads off the store; only `probingKey` changes. */
export interface RowProbe {
  /** The one row currently re-probing, app-wide, or null when idle. */
  probingKey: string | null;
  startProbe: (addr: string, queryPort: number) => void;
  endProbe: (addr: string, queryPort: number) => void;
}

/** One row probes app-wide: the probing row is `busy`, every other row is `disabled`. */
export function rowProbeState(probe: RowProbe, addr: string, queryPort: number) {
  const busy = probe.probingKey === probeKey(addr, queryPort);
  return { busy, disabled: probe.probingKey !== null && !busy };
}

/** Click handler shared by the themed `server.refresh` element and the legacy row button. */
export function probeRow(
  probe: RowProbe,
  addr: string,
  queryPort: number,
  event: { stopPropagation: () => void },
): void {
  event.stopPropagation();
  if (probe.probingKey !== null) return;
  probe.startProbe(addr, queryPort);
  void refreshVisibleServers([{ addr, query_port: queryPort }], "row").finally(() =>
    probe.endProbe(addr, queryPort),
  );
}

export const useRowProbeStore = create<RowProbe>((set, get) => ({
  probingKey: null,
  startProbe: (addr, queryPort) => set({ probingKey: probeKey(addr, queryPort) }),
  endProbe: (addr, queryPort) => {
    // Only clear if this call's probe is still the current one — a stale
    // finally() from a superseded probe must not erase a newer one.
    if (get().probingKey === probeKey(addr, queryPort)) set({ probingKey: null });
  },
}));
