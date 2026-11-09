import { useEffect, useRef, useState } from "react";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import { loadInstalledVersion, useLoadedVersion } from "@/stores/installed-version-store";
import { filterParamsFor } from "@/hooks/use-server-data-loader";
import { getFilterFacets, type FilterFacets } from "@/lib/tauri";
import type { ServerFilter } from "@/types/filters";

const DEBOUNCE_MS = 250;

export interface FacetResult {
  facets: FilterFacets | null;
  /** The last request failed, as opposed to still being in flight. */
  failed: boolean;
}

export interface FacetLoader {
  update(open: boolean, filter: ServerFilter, installedVersion: string | null): void;
  stop(): void;
}

/**
 * Counts for a filter menu. Opens with one request, then waits for the filter to
 * settle before asking again; a reply older than the newest request is dropped.
 */
export function createFacetLoader(
  fetcher: (filter: ServerFilter, installedVersion: string | null) => Promise<FilterFacets>,
  onResult: (result: FacetResult) => void,
): FacetLoader {
  let newest = 0;
  let opened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const run = (filter: ServerFilter, installedVersion: string | null) => {
    const id = ++newest;
    fetcher(filter, installedVersion).then(
      (facets) => {
        if (id === newest) onResult({ facets, failed: false });
      },
      () => {
        if (id === newest) onResult({ facets: null, failed: true });
      },
    );
  };

  return {
    update(open, filter, installedVersion) {
      clear();
      if (!open) {
        opened = false;
        newest++;
        onResult({ facets: null, failed: false });
        return;
      }
      if (!opened) {
        opened = true;
        run(filter, installedVersion);
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        run(filter, installedVersion);
      }, DEBOUNCE_MS);
    },
    stop() {
      clear();
      newest++;
    },
  };
}

export function loadFilterFacets(
  filter: ServerFilter,
  installedVersion: string | null,
): Promise<FilterFacets> {
  return getFilterFacets(filterParamsFor(filter), installedVersion);
}

/** The installed DayZ version, read once per DayZ folder setting; null while unknown. */
export function useInstalledDayzVersion(): string | null {
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const version = useLoadedVersion(dayzPath);

  useEffect(() => {
    void loadInstalledVersion(dayzPath);
  }, [dayzPath]);

  return version;
}

export function useFilterFacets(open: boolean): {
  facets: FilterFacets | null;
  facetError: boolean;
  installedVersion: string | null;
} {
  const filter = useServerStore((s) => s.filter);
  const installedVersion = useInstalledDayzVersion();
  const [result, setResult] = useState<FacetResult>({ facets: null, failed: false });
  const loader = useRef<FacetLoader | null>(null);
  if (!loader.current) loader.current = createFacetLoader(loadFilterFacets, setResult);
  const current = loader.current;

  useEffect(() => {
    current.update(open, filter, installedVersion);
  }, [current, open, filter, installedVersion]);

  useEffect(() => () => current.stop(), [current]);

  return { facets: result.facets, facetError: result.failed, installedVersion };
}
