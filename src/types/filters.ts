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
  official: boolean | null;
  modded: boolean | null;
  first_person: boolean | null;
  // ENGLISH ONLY isn't here: it defaults on, so it lives in
  // AppSettings.englishNamesFilter instead — here it'd reset every launch.
  /** Stringified Workshop ids picked in the "Filter by mod" modal. */
  mod_ids: string[];
  /** Whether a server must declare every id in `mod_ids`, or just one. */
  mod_match: "any" | "all";
  /** Stringified Workshop ids to keep off the list — a server declaring any
      one of these is dropped, independent of `mod_match`. */
  mod_ids_exclude: string[];
}

export type SortKey = 'players' | 'ping' | 'mod_count' | 'name' | 'map' | 'last_played';
export type SortDir = 'asc' | 'desc';