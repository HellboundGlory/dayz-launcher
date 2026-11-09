export interface ServerFilter {
  maps: string[];
  countries: string[];
  hide_empty: boolean;
  hide_full: boolean;
  hide_locked: boolean;
  hide_offline: boolean;
  max_ping: number | null;
  search: string | null;
  favourites_only: boolean;
  recent_only: boolean;
  /** The addresses the LAN tab lists, or null on every other tab. Never restored after a restart. */
  lan_addrs: string[] | null;
  official: boolean | null;
  modded: boolean | null;
  first_person: boolean | null;
  /** Stringified Workshop ids picked in the "Filter by mod" modal. */
  mod_ids: string[];
  /** Whether a server must declare every id in `mod_ids`, or just one. */
  mod_match: "any" | "all";
  /** Stringified Workshop ids to keep off the list — a server declaring any
      one of these is dropped, independent of `mod_match`. */
  mod_ids_exclude: string[];
  /** Game version to match on, e.g. "1.29.161000". Never restored after a restart. */
  version: string | null;
  /** In-game hour half of the day; null means any hour. */
  time_of_day: "day" | "night" | null;
  /** true = BattlEye only, false = the rest, null = both. */
  battleye: boolean | null;
}

/** The ping limits the filter menu offers, in ms. */
export const PING_PRESETS = [50, 100, 150] as const;

export type SortKey = 'players' | 'ping' | 'mod_count' | 'name' | 'map' | 'last_played' | 'country';
export type SortDir = 'asc' | 'desc';