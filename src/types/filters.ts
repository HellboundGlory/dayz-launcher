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
}

export type SortKey = 'players' | 'ping' | 'mod_count' | 'name' | 'map' | 'last_played';
export type SortDir = 'asc' | 'desc';