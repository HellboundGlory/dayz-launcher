import type { ServerFilter } from "@/types/filters";

// What every launch starts from, and the base "Reset filters" restores.
// search/favourites_only/recent_only/lan_addrs don't survive a restart, so
// saving drops them; a reset still carries the latter three over so the active
// tab keeps its scope.
export const DEFAULT_FILTER: ServerFilter = {
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
  lan_addrs: null,
  official: null,
  modded: null,
  first_person: null,
  mod_ids: [],
  mod_match: "any",
  mod_ids_exclude: [],
  version: null,
  time_of_day: null,
  battleye: null,
};

/** The filter "Reset filters" leaves behind: the defaults, the tab's own flags, and `search` as given. */
export function resetFilterFor(filter: ServerFilter, search: string | null): ServerFilter {
  // The sidebar tab owns these three, not the filter bar: resetting them
  // would silently widen a Favourites/Recent/LAN tab to every server.
  return {
    ...DEFAULT_FILTER,
    favourites_only: filter.favourites_only,
    recent_only: filter.recent_only,
    lan_addrs: filter.lan_addrs,
    search,
  };
}
