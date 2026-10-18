import { useCallback, useEffect, useRef, useState } from "react";
import { useServerStore } from "@/stores/server-store";
import {
  getMapList,
  getServerPage,
  getServersByAddr,
  logClient,
  type FilterParams,
} from "@/lib/tauri";
import { PageTracker, type PageRead } from "./server-pages";

const MAP_LIST_REFRESH_MS = 10_000;
const PAGE_SIZE = 200;
const RETRY_MS = 1_000;

interface ServerQuery {
  filterParams: FilterParams;
  sortKey: string;
  sortDir: string;
}

/** Pages touching rows `start`..`end` (inclusive), widened by a page each side and clamped to `total`. */
export function pagesFor(start: number, end: number, total: number, pageSize: number): number[] {
  const first = Math.floor(Math.max(0, start - pageSize) / pageSize);
  const last = Math.floor(Math.min(total - 1, end + pageSize) / pageSize);
  const pages: number[] = [];
  for (let page = first; page <= last; page++) pages.push(page);
  return pages;
}

/** Pages the list needs now: page 0 while the list is empty, else the pages around the visible rows. */
function wantedPages(): number[] {
  const { servers, visibleRange } = useServerStore.getState();
  const total = servers.length;
  if (total === 0) return [0];
  const start = Math.min(visibleRange.start, total - 1);
  const end = Math.min(visibleRange.end, total - 1);
  return pagesFor(start, end, total, PAGE_SIZE);
}

/**
 * Reads one page into the store while `current` holds. A failure comes back as
 * `error`; a page with fewer rows than its total says it should have is `short`.
 */
export async function loadServerPage(
  query: ServerQuery,
  offset: number,
  current: () => boolean,
): Promise<{ error: string | null; short: boolean }> {
  const { setServerPage } = useServerStore.getState();
  const t0 = performance.now();
  void logClient("servers", "load: start", true);
  try {
    const page = await getServerPage(query.filterParams, {
      sort_key: query.sortKey,
      sort_dir: query.sortDir,
      offset,
      limit: PAGE_SIZE,
    });
    const short = page.rows.length < Math.min(PAGE_SIZE, page.total - offset);
    if (current()) setServerPage(offset, page.rows, page.total);
    void logClient(
      "servers",
      `load: ${page.rows.length} rows in ${Math.round(performance.now() - t0)}ms`,
      true,
    );
    return { error: null, short };
  } catch (e) {
    void logClient("servers", `load: failed: ${String(e)}`);
    console.error("Failed to load servers:", e);
    return { error: `Could not load the server list: ${String(e)}`, short: false };
  }
}

export function useServerDataLoader() {
  const filter = useServerStore((s) => s.filter);
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const loadVersion = useServerStore((s) => s.loadVersion);
  const visibleRange = useServerStore((s) => s.visibleRange);
  const setMaps = useServerStore((s) => s.setMaps);

  const [pages] = useState(() => new PageTracker());
  const queryRef = useRef<ServerQuery | null>(null);
  const retryTimers = useRef(new Map<number, number>());
  const shortLogged = useRef(new Set<number>());
  const lastLoadVersion = useRef(loadVersion);

  const loadWanted: () => void = useCallback(() => {
    const query = queryRef.current;
    if (!query) return;
    pages.want(wantedPages());
    for (const page of pages.next()) {
      const read: PageRead = pages.started(page);
      const offset = page * PAGE_SIZE;
      void loadServerPage(query, offset, () => pages.isCurrent(read)).then(
        ({ error, short }) => {
          if (!pages.isCurrent(read)) return;
          pages.finished(read, error === null);
          const { setLoadError, setHasLoadedOnce } = useServerStore.getState();
          if (short && !shortLogged.current.has(offset)) {
            shortLogged.current.add(offset);
            void logClient("servers", `load: short page at ${offset}`);
          }
          if (error === null) {
            if (!pages.hasFailures()) setLoadError(null);
          } else {
            setLoadError(error);
            if (!retryTimers.current.has(page)) {
              retryTimers.current.set(
                page,
                window.setTimeout(() => {
                  retryTimers.current.delete(page);
                  pages.retry(page);
                  loadWanted();
                }, RETRY_MS),
              );
            }
          }
          setHasLoadedOnce();
          loadWanted();
        },
      );
    }
  }, [pages]);

  useEffect(() => {
    pages.reset();
    for (const timer of retryTimers.current.values()) window.clearTimeout(timer);
    retryTimers.current.clear();
    shortLogged.current.clear();
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
      sortKey,
      sortDir,
    };
    useServerStore.getState().clearRows();
    loadWanted();
  }, [filter, sortKey, sortDir, pages, loadWanted]);

  useEffect(() => {
    if (loadVersion === lastLoadVersion.current) return;
    lastLoadVersion.current = loadVersion;
    pages.invalidate();
    loadWanted();

    const { selectedServer, servers } = useServerStore.getState();
    if (!selectedServer) return;
    const loaded = servers.some(
      (s) => s?.addr === selectedServer.addr && s.query_port === selectedServer.query_port,
    );
    if (loaded) return;
    void getServersByAddr([selectedServer.addr])
      .then(([fresh]) => {
        if (fresh) useServerStore.getState().refreshSelectedServer(fresh);
      })
      .catch((e) => void logClient("servers", `selection refresh failed: ${String(e)}`));
  }, [loadVersion, pages, loadWanted]);

  useEffect(() => {
    loadWanted();
  }, [visibleRange, loadWanted]);

  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

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
