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
  /** Set while waiting on Steam Workshop downloads; suppresses A2S probing meanwhile. */
  downloadsActive: boolean;
  setDownloadsActive: (active: boolean) => void;

  /** Servers with a Steam update pending, from the last targeted refresh. Merged, not replaced, per refresh. */
  modPending: Record<string, boolean>;
  mergeModPending: (entries: { addr: string; pending: boolean }[]) => void;

  /** Distinct maps seen by the registry, as `[normalised, display]` pairs. Refetched on its own slow interval. */
  maps: [string, string][];
  /** True once `maps` has been fetched at least once (even if empty). */
  mapsLoaded: boolean;
  /** True once the server table has completed its first load, empty or not — a splash-readiness gate. */
  hasLoadedOnce: boolean;
  setMaps: (maps: [string, string][]) => void;
  setHasLoadedOnce: () => void;

  setServers: (servers: Server[]) => void;
  setSelectedServer: (server: Server | null) => void;
  setFilter: (filter: Partial<ServerFilter>) => void;
  setSort: (key: SortKey, dir: SortDir) => void;
  resetFilter: () => void;
  setLoading: (loading: boolean) => void;
  setTotalCount: (count: number) => void;
  toggleFavourite: (addr: string) => void;
  triggerReload: () => void;
}

// Shallow compare over every key, not a hand-picked subset, so a field added
// to `Server` later doesn't silently stop propagating to the details panel.
function sameRow(a: Server, b: Server): boolean {
  const keys = Object.keys(a) as (keyof Server)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

const SORT_KEY_STORAGE = "tetra.sort.v1";

// What every launch starts from, and what "Reset filters" restores.
// search/favourites_only/recent_only don't survive a restart — see persistFilter.
const DEFAULT_FILTER: ServerFilter = {
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
};

/** Persisted filters use their own key — the opposite choice from settings. */
const FILTER_STORAGE = "tetra.filter.v1";

// Validates each field; a corrupt/hand-edited value falls back to defaults
// rather than crashing the table. search/favourites_only/recent_only are
// never restored, so the app always opens on the All tab with an empty search.
function loadFilter(): ServerFilter {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE);
    if (!raw) return DEFAULT_FILTER;
    const saved = JSON.parse(raw) as Partial<ServerFilter>;
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const tri = (v: unknown): boolean | null =>
      v === true || v === false ? v : null;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return {
      maps: strings(saved.maps),
      countries: strings(saved.countries),
      hide_empty: bool(saved.hide_empty, DEFAULT_FILTER.hide_empty),
      hide_full: bool(saved.hide_full, DEFAULT_FILTER.hide_full),
      hide_locked: bool(saved.hide_locked, DEFAULT_FILTER.hide_locked),
      hide_offline: bool(saved.hide_offline, DEFAULT_FILTER.hide_offline),
      max_ping: typeof saved.max_ping === "number" ? saved.max_ping : null,
      search: null,
      favourites_only: false,
      recent_only: false,
      official: tri(saved.official),
      modded: tri(saved.modded),
      first_person: tri(saved.first_person),
    };
  } catch {
    return DEFAULT_FILTER;
  }
}

// Strips the transient fields (search, favourites_only, recent_only) before saving.
function persistFilter(filter: ServerFilter) {
  const { search, favourites_only, recent_only, ...kept } = filter;
  try {
    localStorage.setItem(FILTER_STORAGE, JSON.stringify(kept));
  } catch {
    // Non-fatal: the filter just won't survive a restart.
  }
}

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
  filter: loadFilter(),
  ...loadSort(),
  isLoading: false,
  totalCount: 0,
  loadVersion: 0,
  downloadsActive: false,
  modPending: {},
  maps: [],
  mapsLoaded: false,
  hasLoadedOnce: false,

  // Replaces the table's rows and re-points the selection at its new row, so
  // the details panel stays live instead of showing a stale click-time snapshot.
  setServers: (servers) =>
    set((state) => {
      const selected = state.selectedServer;
      if (!selected) return { servers };
      const fresh = servers.find(
        (s) => s.addr === selected.addr && s.query_port === selected.query_port,
      );
      // Keep the old object if unchanged, and if missing (probably filtered
      // out, not gone) — avoids repainting the panel on every reload.
      if (!fresh || sameRow(fresh, selected)) return { servers };
      return { servers, selectedServer: fresh };
    }),
  setSelectedServer: (server) => set({ selectedServer: server }),
  setFilter: (filter) =>
    set((state) => {
      const next = { ...state.filter, ...filter };
      persistFilter(next);
      return { filter: next };
    }),
  setSort: (sortKey, sortDir) => {
    try {
      localStorage.setItem(SORT_KEY_STORAGE, JSON.stringify({ sortKey, sortDir }));
    } catch {
      // Non-fatal: the choice simply won't survive a restart.
    }
    set({ sortKey, sortDir });
  },
  setLoading: (isLoading) => set({ isLoading }),
  resetFilter: () => {
    persistFilter(DEFAULT_FILTER);
    set({ filter: DEFAULT_FILTER });
  },
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