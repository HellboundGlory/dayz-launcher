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
}

export type SortKey = 'players' | 'ping' | 'mod_count' | 'name' | 'map' | 'last_played';
export type SortDir = 'asc' | 'desc';