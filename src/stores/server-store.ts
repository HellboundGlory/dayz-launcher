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
   * Refetched on its own slow interval, decoupled from the row-reload effect
   * (see `server-list.tsx`'s `MAP_LIST_REFRESH_MS` — H3, 2026-08-29 audit),
   * so the filter dropdown still grows live as discovery writes new maps
   * without riding every discovery-driven reload. It previously fetched once
   * on mount and stayed frozen even as the registry filled.
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
  resetFilter: () => void;
  setLoading: (loading: boolean) => void;
  setTotalCount: (count: number) => void;
  toggleFavourite: (addr: string) => void;
  triggerReload: () => void;
}

/**
 * Sort choice lives in localStorage rather than settings.json: it is view
 * state, it changes on a single click, and a round trip to disk through the
 * Tauri bridge for every header click would be wasteful.
 *
 * L12 (2026-08-29 audit): this used to also claim column widths persisted
 * the same way, in a `server-table.tsx` — both stale. The columned,
 * resizable table was replaced by `server-list.tsx`'s card rows, which have
 * no per-column width to persist at all.
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

/**
 * The filter state every launch starts from, and what "Reset filters" restores.
 *
 * `search`, `favourites_only` and `recent_only` are deliberately *not* meant to
 * survive a restart (see `persistFilter`) — search is transient by design and
 * the two *_only fields are driven by the All/Favourites/Recent tabs, which
 * always start on All.
 */
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

/**
 * Read the saved filter from localStorage, validating each field.
 *
 * Mirrors `loadSort`: a corrupt or hand-edited value must fall back to
 * defaults rather than crashing the table or producing a nonsense query.
 *
 * `search` / `favourites_only` / `recent_only` are never restored (defaults),
 * so the search box starts empty and the app opens on the All tab.
 */
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

/**
 * Write the filter to localStorage, stripping the transient fields.
 *
 * `search` is deliberately dropped (A6) and `favourites_only`/`recent_only`
 * with it (A7 — tab selection must not survive a restart). Non-fatal: a full
 * storage means the choice simply won't persist.
 */
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

  /**
   * Replace the table's rows, and re-point the selection at its new row.
   *
   * The re-point is what makes the details panel live. `selectedServer` was a
   * snapshot taken at click time and never touched again, so a refresh updated
   * every row in the table while the panel beside it went on showing the ping,
   * player count and mod count from whenever the row was first clicked. The only
   * way to see current values was to click away and back.
   *
   * Matched on `addr` and `query_port` together, even though `addr` already
   * embeds the query port (`"ip:query_port"`, see `Server32` on the Rust
   * side) and is unique on its own — the second check is redundant, not
   * load-bearing.
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