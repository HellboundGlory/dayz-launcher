import type { ServerFilter } from "@/types/filters";

const TRI_STATES = ["official", "modded", "first_person", "battleye"] as const;

/** One per filter the user turned on; the search text and the tab flags never count. */
export function activeFilterCount(filter: ServerFilter): number {
  let count = 0;
  if (filter.maps.length > 0) count++;
  if (filter.countries.length > 0) count++;
  if (filter.version !== null) count++;
  for (const field of TRI_STATES) if (filter[field] !== null) count++;
  if (filter.time_of_day !== null) count++;
  if (filter.mod_ids.length > 0 || filter.mod_ids_exclude.length > 0) count++;
  if (filter.max_ping !== null) count++;
  if (filter.hide_offline) count++;
  if (filter.hide_locked) count++;
  if (filter.hide_empty) count++;
  if (filter.hide_full) count++;
  return count;
}
