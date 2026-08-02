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
   * The row-index range the table currently has mounted, per
   * `rowVirtualizer.getVirtualItems()` in `server-table.tsx`.
   *
   * Written on every scroll/resize, but nothing selects it reactively — it
   * exists purely so `handleRefresh` in `App.tsx` can read
   * `useServerStore.getState()` at click time and know which rows are
   * actually visible, without ServerTable and the refresh button needing a
   * direct reference to each other.
   */
  visibleRange: { start: number; end: number } | null;
  setVisibleRange: (range: { start: number; end: number } | null) => void;

  /**
   * Servers whose declared mods came back with a Steam update pending, from
   * the last targeted refresh. Keyed by `addr` (already `ip:query_port`,
   * unique). Merged rather than replaced on each refresh — only the servers
   * that were actually re-probed are touched, so a server currently off
   * screen keeps whatever it last reported.
   */
  modPending: Record<string, boolean>;
  mergeModPending: (entries: { addr: string; pending: boolean }[]) => void;

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
  visibleRange: null,
  modPending: {},

  setServers: (servers) => set({ servers }),
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
  setVisibleRange: (visibleRange) => set({ visibleRange }),
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