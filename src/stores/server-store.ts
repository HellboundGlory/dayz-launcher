import { create } from "zustand";
import type { Server } from "@/types/server";
import type { ServerFilter, SortKey, SortDir } from "@/types/filters";

interface ServerState {
  servers: Server[];
  selectedServer: Server | null;
  filter: ServerFilter;
  sortKey: SortKey;
  sortDir: SortDir;
  isLoading: boolean;
  totalCount: number;
  loadVersion: number;
  /**
   * Set while the launcher is waiting on Steam Workshop downloads.
   *
   * Probing is suppressed during this: an A2S refresh opens up to
   * `MAX_IN_FLIGHT` UDP sockets across thousands of servers, and there is no
   * reason to compete with a download the user is actively waiting for.
   */
  downloadsActive: boolean;
  setDownloadsActive: (active: boolean) => void;

  /**
   * Servers whose declared mods came back with a Steam update pending, from
   * the last targeted refresh. Keyed by `addr` (already `ip:query_port`,
   * unique). Merged rather than replaced on each refresh — only the servers
   * that were actually re-probed are touched, so a server currently off
   * screen keeps whatever it last reported.
   */
  modPending: Record<string, boolean>;
  mergeModPending: (entries: { addr: string; pending: boolean }[]) => void;

  /**
   * Distinct maps seen by the registry, as `[normalised, display]` pairs.
   *
   * Refetched on every reload (see `server-table.tsx`), so the filter
   * dropdown grows live as discovery writes new maps — it previously fetched
   * once on mount and stayed frozen even as the registry filled.
   */
  maps: [string, string][];
  /** True once `maps` has been fetched at least once (even if empty). */
  mapsLoaded: boolean;
  /**
   * True once the server table has completed its first load, empty or not.
   *
   * The splash screen uses this as one of the gates for "startup is ready":
   * discovery can be done and the list countably present before the first
   * `get_server_list` ever lands.
   */
  hasLoadedOnce: boolean;
  setMaps: (maps: [string, string][]) => void;
  setHasLoadedOnce: () => void;

  setServers: (servers: Server[]) => void;
  setSelectedServer: (server: Server | null) => void;
  setFilter: (filter: Partial<ServerFilter>) => void;
  setSort: (key: SortKey, dir: SortDir) => void;
  setLoading: (loading: boolean) => void;
  setTotalCount: (count: number) => void;
  toggleFavourite: (addr: string) => void;
  triggerReload: () => void;
}

/**
 * Sort choice lives in localStorage rather than settings.json: it is view
 * state, it changes on a single click, and a round trip to disk through the
 * Tauri bridge for every header click would be wasteful. Column widths persist
 * the same way, in `server-table.tsx`.
 */
/**
 * Whether two rows for the same server carry identical values.
 *
 * A shallow compare over every key rather than a hand-picked list of "the ones
 * that change": a field added to `Server` later would silently stop propagating
 * to the details panel if this only checked a fixed set, and that failure looks
 * exactly like the staleness bug this exists to fix.
 */
function sameRow(a: Server, b: Server): boolean {
  const keys = Object.keys(a) as (keyof Server)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

const SORT_KEY_STORAGE = "tetra.sort.v1";

function loadSort(): { sortKey: SortKey; sortDir: SortDir } {
  const fallback = { sortKey: "players" as SortKey, sortDir: "desc" as SortDir };
  try {
    const raw = localStorage.getItem(SORT_KEY_STORAGE);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as { sortKey?: string; sortDir?: string };
    const validKeys = ["players", "ping", "mod_count", "name", "map", "last_played"];
    return {
      sortKey: validKeys.includes(saved.sortKey ?? "")
        ? (saved.sortKey as SortKey)
        : fallback.sortKey,
      sortDir: saved.sortDir === "asc" ? "asc" : "desc",
    };
  } catch {
    return fallback;
  }
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  selectedServer: null,
  filter: {
    maps: [],
    countries: [],
    hide_empty: false,
    hide_full: false,
    hide_locked: false,
    hide_offline: false,
    max_ping: null,
    search: null,
    favourites_only: false,
    recent_only: false,
    official: null,
    modded: null,
    first_person: null,
  },
  ...loadSort(),
  isLoading: false,
  totalCount: 0,
  loadVersion: 0,
  downloadsActive: false,
  modPending: {},
  maps: [],
  mapsLoaded: false,
  hasLoadedOnce: false,

  /**
   * Replace the table's rows, and re-point the selection at its new row.
   *
   * The re-point is what makes the details panel live. `selectedServer` was a
   * snapshot taken at click time and never touched again, so a refresh updated
   * every row in the table while the panel beside it went on showing the ping,
   * player count and mod count from whenever the row was first clicked. The only
   * way to see current values was to click away and back.
   *
   * Matched on `addr` *and* `query_port`: one machine commonly runs several
   * servers, so the address alone is not unique — GulagZ answers on 2303 and
   * 2403 from one IP, and matching on address would have pointed the panel at
   * whichever came first.
   *
   * A selection with no row in the new list keeps its old object rather than
   * being cleared. It is usually still on screen and simply excluded by the
   * current filter or search; blanking the panel mid-read would be worse than
   * showing values a moment old.
   */
  setServers: (servers) =>
    set((state) => {
      const selected = state.selectedServer;
      if (!selected) return { servers };
      const fresh = servers.find(
        (s) => s.addr === selected.addr && s.query_port === selected.query_port,
      );
      // Keep the existing object when nothing about the row changed. The
      // identity is what the details panel re-renders on, and `setServers` runs
      // roughly four times a second while discovery streams — swapping in an
      // equal-but-new object would repaint the panel, its stat cards and a
      // 93-row mod list on every one of those for no visible difference.
      if (!fresh || sameRow(fresh, selected)) return { servers };
      return { servers, selectedServer: fresh };
    }),
  setSelectedServer: (server) => set({ selectedServer: server }),
  setFilter: (filter) =>
    set((state) => ({ filter: { ...state.filter, ...filter } })),
  setSort: (sortKey, sortDir) => {
    try {
      localStorage.setItem(SORT_KEY_STORAGE, JSON.stringify({ sortKey, sortDir }));
    } catch {
      // Non-fatal: the choice simply won't survive a restart.
    }
    set({ sortKey, sortDir });
  },
  setLoading: (isLoading) => set({ isLoading }),
  setDownloadsActive: (downloadsActive) => set({ downloadsActive }),
  setTotalCount: (totalCount) => set({ totalCount }),
  setMaps: (maps) => set({ maps, mapsLoaded: true }),
  setHasLoadedOnce: () => set({ hasLoadedOnce: true }),
  mergeModPending: (entries) =>
    set((state) => {
      if (entries.length === 0) return state;
      const modPending = { ...state.modPending };
      for (const e of entries) modPending[e.addr] = e.pending;
      return { modPending };
    }),
  toggleFavourite: (addr) =>
    set((state) => ({
      servers: state.servers.map((s) =>
        s.addr === addr ? { ...s, favourite: !s.favourite } : s,
      ),
      selectedServer:
        state.selectedServer?.addr === addr
          ? { ...state.selectedServer, favourite: !state.selectedServer.favourite }
          : state.selectedServer,
    })),
  triggerReload: () => set((state) => ({ loadVersion: state.loadVersion + 1 })),
}));