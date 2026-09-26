import { useCallback, useEffect, useRef } from "react";
import { useServerStore } from "@/stores/server-store";
import {
  getServerList,
  getMapList,
  logClient,
  type FilterParams,
  type SortParams,
} from "@/lib/tauri";

const MAP_LIST_REFRESH_MS = 10_000;

export function useServerDataLoader() {
  const setServers = useServerStore((s) => s.setServers);
  const filter = useServerStore((s) => s.filter);
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const loadVersion = useServerStore((s) => s.loadVersion);
  const setLoading = useServerStore((s) => s.setLoading);
  const setMaps = useServerStore((s) => s.setMaps);
  const setHasLoadedOnce = useServerStore((s) => s.setHasLoadedOnce);

  const loadInFlight = useRef(false);
  const reloadQueued = useRef(false);
  const queryRef = useRef<{
    filterParams: FilterParams;
    sortParams: SortParams;
  } | null>(null);

  const runLoad = useCallback(async () => {
    if (loadInFlight.current) {
      reloadQueued.current = true;
      return;
    }
    loadInFlight.current = true;
    setLoading(true);
    try {
      do {
        reloadQueued.current = false;
        const query = queryRef.current;
        if (!query) break;
        const t0 = performance.now();
        void logClient("servers", "load: start", true);
        try {
          const rows = await getServerList(
            query.filterParams,
            query.sortParams,
          );
          setServers(rows);
          void logClient(
            "servers",
            `load: ${rows.length} rows in ${Math.round(performance.now() - t0)}ms`,
            true,
          );
        } catch (e) {
          void logClient("servers", `load: failed: ${String(e)}`);
          console.error("Failed to load servers:", e);
        }
      } while (reloadQueued.current);
    } finally {
      loadInFlight.current = false;
      setLoading(false);
      setHasLoadedOnce();
    }
  }, [setLoading, setServers, setHasLoadedOnce]);

  useEffect(() => {
    queryRef.current = {
      filterParams: {
        maps: filter.maps,
        countries: filter.countries,
        hide_empty: filter.hide_empty,
        hide_full: filter.hide_full,
        hide_locked: filter.hide_locked,
        hide_offline: filter.hide_offline,
        max_ping: filter.max_ping,
        search: filter.search,
        favourites_only: filter.favourites_only,
        recent_only: filter.recent_only,
        official: filter.official,
        modded: filter.modded,
        first_person: filter.first_person,
        mod_ids: filter.mod_ids,
        mod_match: filter.mod_match,
        mod_ids_exclude: filter.mod_ids_exclude,
      },
      sortParams: {
        sort_key: sortKey,
        sort_dir: sortDir,
        limit: 40000,
      },
    };
    void runLoad();
  }, [filter, sortKey, sortDir, loadVersion, runLoad]);

  useEffect(() => {
    let cancelled = false;
    const fetchMaps = () => {
      getMapList()
        .then((maps) => {
          if (!cancelled) setMaps(maps);
        })
        .catch((e) => {
          if (!cancelled)
            void logClient("servers", `getMapList failed: ${String(e)}`);
        });
    };
    fetchMaps();
    const id = window.setInterval(fetchMaps, MAP_LIST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setMaps]);
}
