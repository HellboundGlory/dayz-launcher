export interface ServerFilter {
  maps: string[];
  countries: string[];
  hide_empty: boolean;
  hide_full: boolean;
  hide_locked: boolean;
  max_ping: number | null;
  search: string | null;
  favourites_only: boolean;
  recent_only: boolean;
  official: boolean | null;
  modded: boolean | null;
  first_person: boolean | null;
  /**
   * ENGLISH ONLY. `true` keeps Latin-script names, `false` keeps only
   * non-Latin ones, `null` does not filter on script at all.
   */
  latin_names: boolean | null;
}

export type SortKey = 'players' | 'ping' | 'mod_count' | 'name' | 'map' | 'last_played';
export type SortDir = 'asc' | 'desc';