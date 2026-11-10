import { create } from "zustand";
import type { Server } from "@/types/server";
import type { ServerFilter, SortKey, SortDir } from "@/types/filters";
import { PING_PRESETS } from "@/types/filters";
import { legacyRegionCountries } from "@/lib/countries";
import { DEFAULT_FILTER, resetFilterFor } from "./filter-reset";

export { DEFAULT_FILTER };

export type ServerLookup = { addr: string; state: "asking" | "noanswer" };

interface ServerState {
  /** One entry per row the filter matches; `undefined` is a row not loaded yet. */
  servers: (Server | undefined)[];
  /** Inclusive indices of the rows the list is drawing. */
  visibleRange: { start: number; end: number };
  selectedServer: Server | null;
  filter: ServerFilter;
  sortKey: SortKey;
  sortDir: SortDir;
  loadVersion: number;
  /** True during a refresh sweep, when `server-refreshed` patches rows instead of reloading. */
  refreshActive: boolean;
  setRefreshActive: (active: boolean) => void;

  /** Servers with a Steam update pending, from the last targeted refresh. Merged, not replaced, per refresh. */
  modPending: Record<string, boolean>;
  mergeModPending: (entries: { addr: string; pending: boolean }[]) => void;

  /** Distinct maps seen by the registry, as `[normalised, display]` pairs. Refetched on its own slow interval. */
  maps: [string, string][];
  /** True once `maps` has been fetched at least once (even if empty). */
  mapsLoaded: boolean;
  /** True once the server table has completed its first load, empty or not — a splash-readiness gate. */
  hasLoadedOnce: boolean;
  /** Why the last server-list load failed, or null. Cleared by the next successful load. */
  loadError: string | null;
  setMaps: (maps: [string, string][]) => void;
  setHasLoadedOnce: () => void;
  setLoadError: (error: string | null) => void;

  /** A search address being asked of the server directly, while it is asking or after no answer. */
  lookup: ServerLookup | null;
  setLookup: (lookup: ServerLookup | null) => void;
  /** The search and total of the last applied page for the current query; null while a query is loading. */
  settled: { search: string | null; total: number } | null;
  setSettled: (settled: ServerState["settled"]) => void;

  setServerPage: (offset: number, rows: Server[], total: number) => void;
  patchServers: (rows: Server[]) => void;
  clearRows: () => void;
  setVisibleRange: (start: number, end: number) => void;
  refreshSelectedServer: (fresh: Server) => void;
  setSelectedServer: (server: Server | null) => void;
  setFilter: (filter: Partial<ServerFilter>) => void;
  setSort: (key: SortKey, dir: SortDir) => void;
  resetFilter: () => void;
  toggleFavourite: (addr: string) => void;
  triggerReload: () => void;
  /** Runs a reload after `delayMs`, dropping the call while one is already pending. */
  requestReload: (delayMs: number, onFire?: () => void) => void;
}

// Shallow compare over every key, not a hand-picked subset, so a field added
// to `Server` later doesn't silently stop propagating to the details panel.
function sameRow(a: Server, b: Server): boolean {
  const keys = Object.keys(a) as (keyof Server)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

const SORT_KEY_STORAGE = "tetra.sort.v1";

/** Persisted filters use their own key — the opposite choice from settings. */
const FILTER_STORAGE = "tetra.filter.v1";

/**
 * An old slider value as one of the ping presets: the nearest, ties rounding up
 * to the tighter limit. Over 175 becomes "any", because no preset is close to a
 * limit that loose and keeping it would filter by something the control cannot show.
 */
export function snapPing(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (v > 175) return null;
  let best: number = PING_PRESETS[0];
  for (const preset of PING_PRESETS) {
    // `<=` so an exactly midway value rounds up to the larger (tighter) limit.
    if (Math.abs(preset - v) <= Math.abs(best - v)) best = preset;
  }
  return best;
}

// A save from before countries were real country codes holds region codes;
// expand those so the same part of the world stays selected.
function loadCountries(saved: unknown, scheme: unknown): string[] {
  const values = Array.isArray(saved)
    ? saved.filter((x): x is string => typeof x === "string")
    : [];
  if (scheme !== 2) {
    const codes = values.flatMap((value) => legacyRegionCountries(value));
    return [...new Set(codes)].sort();
  }
  return [...new Set(values.filter((value) => /^[A-Z]{2}$/.test(value)))];
}

// Validates each field; a corrupt/hand-edited value falls back to defaults
// rather than crashing the table. search/favourites_only/recent_only/lan_addrs
// are never restored, so the app always opens on the All tab with an empty search.
function loadFilter(): ServerFilter {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE);
    if (!raw) return DEFAULT_FILTER;
    const saved = JSON.parse(raw) as Partial<ServerFilter> & { country_scheme?: number };
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const tri = (v: unknown): boolean | null =>
      v === true || v === false ? v : null;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return {
      maps: strings(saved.maps),
      countries: loadCountries(saved.countries, saved.country_scheme),
      hide_empty: bool(saved.hide_empty, DEFAULT_FILTER.hide_empty),
      hide_full: bool(saved.hide_full, DEFAULT_FILTER.hide_full),
      hide_locked: bool(saved.hide_locked, DEFAULT_FILTER.hide_locked),
      hide_offline: bool(saved.hide_offline, DEFAULT_FILTER.hide_offline),
      max_ping: snapPing(saved.max_ping),
      search: null,
      favourites_only: false,
      recent_only: false,
      lan_addrs: null,
      official: tri(saved.official),
      modded: tri(saved.modded),
      first_person: tri(saved.first_person),
      mod_ids: strings(saved.mod_ids),
      mod_match: saved.mod_match === "all" ? "all" : "any",
      mod_ids_exclude: strings(saved.mod_ids_exclude),
      // Not restored: a DayZ update would otherwise silently hide every server.
      version: null,
      time_of_day:
        saved.time_of_day === "day" || saved.time_of_day === "night" ? saved.time_of_day : null,
      battleye: tri(saved.battleye),
    };
  } catch {
    return DEFAULT_FILTER;
  }
}

// Strips the transient fields (search, favourites_only, recent_only, lan_addrs)
// and the version, which is re-chosen per session, before saving.
// `country_scheme` marks `countries` as real country codes, so an older save's
// regions are not read as countries.
function persistFilter(filter: ServerFilter) {
  const { search, favourites_only, recent_only, lan_addrs, version, ...kept } = filter;
  try {
    localStorage.setItem(FILTER_STORAGE, JSON.stringify({ ...kept, country_scheme: 2 }));
  } catch {
    // Non-fatal: the filter just won't survive a restart.
  }
}

// A lookup answers one search text; it is dropped as soon as the text changes.
function keptLookup(state: ServerState, search: string | null): ServerLookup | null {
  return search === state.filter.search ? state.lookup : null;
}

function loadSort(): { sortKey: SortKey; sortDir: SortDir } {
  const fallback = { sortKey: "players" as SortKey, sortDir: "desc" as SortDir };
  try {
    const raw = localStorage.getItem(SORT_KEY_STORAGE);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as { sortKey?: string; sortDir?: string };
    const validKeys = ["players", "ping", "mod_count", "name", "map", "last_played", "country"];
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

let reloadTimer: ReturnType<typeof setTimeout> | undefined;

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  visibleRange: { start: 0, end: 0 },
  selectedServer: null,
  filter: loadFilter(),
  ...loadSort(),
  loadVersion: 0,
  refreshActive: false,
  modPending: {},
  maps: [],
  mapsLoaded: false,
  hasLoadedOnce: false,
  loadError: null,
  lookup: null,
  settled: null,

  // Writes one page and re-points the selection at its fresh row, so the
  // details panel stays live instead of showing a stale click-time snapshot.
  // A new total pads or truncates the array; rows already loaded are kept.
  setServerPage: (offset, rows, total) =>
    set((state) => {
      const servers = Array.from({ length: total }, (_, i) => state.servers[i]);
      rows.forEach((row, i) => {
        servers[offset + i] = row;
      });
      const selected = state.selectedServer;
      if (!selected) return { servers };
      const fresh = rows.find(
        (s) => s.addr === selected.addr && s.query_port === selected.query_port,
      );
      // Keep the old object if unchanged, and if missing (probably filtered
      // out, not gone) — avoids repainting the panel on every reload.
      if (!fresh || sameRow(fresh, selected)) return { servers };
      return { servers, selectedServer: fresh };
    }),
  // Updates rows where they sit; a re-sort waits for the next reload so rows stay under the cursor.
  patchServers: (rows) =>
    set((state) => {
      const fresh = new Map(rows.map((row) => [row.addr, row]));
      // A refresh reads rows outside the search, so it can't say which mod matched; keep the old answer.
      const merged = (old: Server): Server | undefined => {
        const row = fresh.get(old.addr);
        return row && old.matched_mod && !row.matched_mod ? { ...row, matched_mod: old.matched_mod } : row;
      };
      const servers = state.servers.map((s) => (s && merged(s)) || s);
      const selected = state.selectedServer;
      const next = selected ? merged(selected) : undefined;
      if (!selected || !next || sameRow(next, selected)) return { servers };
      return { servers, selectedServer: next };
    }),
  clearRows: () =>
    set((state) => ({ servers: state.servers.map(() => undefined) })),
  setVisibleRange: (start, end) =>
    set((state) =>
      state.visibleRange.start === start && state.visibleRange.end === end
        ? state
        : { visibleRange: { start, end } },
    ),
  refreshSelectedServer: (fresh) =>
    set((state) => {
      const selected = state.selectedServer;
      if (
        !selected ||
        selected.addr !== fresh.addr ||
        selected.query_port !== fresh.query_port ||
        sameRow(fresh, selected)
      ) {
        return state;
      }
      return { selectedServer: fresh };
    }),
  setSelectedServer: (server) => set({ selectedServer: server }),
  setFilter: (filter) =>
    set((state) => {
      const next = { ...state.filter, ...filter };
      persistFilter(next);
      return { filter: next, lookup: keptLookup(state, next.search) };
    }),
  setSort: (sortKey, sortDir) => {
    try {
      localStorage.setItem(SORT_KEY_STORAGE, JSON.stringify({ sortKey, sortDir }));
    } catch {
      // Non-fatal: the choice simply won't survive a restart.
    }
    set({ sortKey, sortDir });
  },
  resetFilter: () =>
    set((state) => {
      const next = resetFilterFor(state.filter, null);
      persistFilter(next);
      return { filter: next, lookup: keptLookup(state, next.search) };
    }),
  setRefreshActive: (refreshActive) => set({ refreshActive }),
  // Polled; an unchanged list keeps its identity, so the map filter does not re-render.
  setMaps: (maps) =>
    set((s) =>
      s.mapsLoaded &&
      s.maps.length === maps.length &&
      s.maps.every(([id, name], i) => id === maps[i][0] && name === maps[i][1])
        ? s
        : { maps, mapsLoaded: true },
    ),
  setHasLoadedOnce: () => set({ hasLoadedOnce: true }),
  setLoadError: (loadError) => set({ loadError }),
  setLookup: (lookup) => set({ lookup }),
  setSettled: (settled) => set({ settled }),
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
        s?.addr === addr ? { ...s, favourite: !s.favourite } : s,
      ),
      selectedServer:
        state.selectedServer?.addr === addr
          ? { ...state.selectedServer, favourite: !state.selectedServer.favourite }
          : state.selectedServer,
    })),
  triggerReload: () => set((state) => ({ loadVersion: state.loadVersion + 1 })),
  requestReload: (delayMs, onFire) => {
    if (reloadTimer !== undefined) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      get().triggerReload();
      onFire?.();
    }, delayMs);
  },
}));