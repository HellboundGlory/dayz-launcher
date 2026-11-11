import type { ViewId } from "@/theme/elements/context";
import type { ServerFilter } from "@/types/filters";

/**
 * Whether the filter describes a tab that lists saved servers — Favourites,
 * Recent or LAN — rather than the All-servers list. On those tabs every filter
 * but the search is ignored.
 */
export function isSavedTab(filter: Pick<ServerFilter, "favourites_only" | "recent_only" | "lan_addrs">): boolean {
  return filter.favourites_only || filter.recent_only || filter.lan_addrs !== null;
}

/** The filter fields a nav tab sets: LAN points at its stored addresses, every other tab lets go of them. */
export function filterForView(
  view: ViewId,
  lanAddrs: string[],
): Pick<ServerFilter, "favourites_only" | "recent_only" | "lan_addrs"> {
  return {
    favourites_only: view === "fav",
    recent_only: view === "recent",
    lan_addrs: view === "lan" ? lanAddrs : null,
  };
}
