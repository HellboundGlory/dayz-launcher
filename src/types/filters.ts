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
  // ENGLISH ONLY is deliberately absent: it defaults to on, so it is persisted
  // in `AppSettings.englishNamesFilter` rather than held here where every launch
  // would reset it. The filter bar reads and writes it through the settings
  // store, and `server-list` merges it into the wire `FilterParams`.
}

export type SortKey = 'players' | 'ping' | 'mod_count' | 'name' | 'map' | 'last_played';
export type SortDir = 'asc' | 'desc';