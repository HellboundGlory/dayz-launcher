import { useEffect, useMemo, useRef, useState } from "react";
import { filterParamsFor } from "@/hooks/use-server-data-loader";
import { createDebouncedLoader } from "@/hooks/debounced-loader";
import { isSavedTab } from "@/lib/saved-tab";
import { getSearchSuggestions, type FilterParams, type SearchSuggestion } from "@/lib/tauri";
import type { ServerFilter } from "@/types/filters";

const MIN_TEXT = 2;

/** A list and the text it answers. */
export interface SuggestionResult {
  query: string;
  list: SearchSuggestion[];
}

export interface SuggestionLoader {
  update(focused: boolean, allServers: boolean, params: FilterParams, text: string): void;
  stop(): void;
}

/** Suggestion lookup that waits for the typing to settle and drops stale replies. */
export function createSuggestionLoader(
  fetcher: (params: FilterParams, text: string) => Promise<SearchSuggestion[]>,
  onResult: (result: SuggestionResult | null) => void,
): SuggestionLoader {
  const loader = createDebouncedLoader<SuggestionResult>(onResult, () => onResult(null));

  return {
    update(focused, allServers, params, text) {
      const query = text.trim();
      if (!focused || !allServers || query.length < MIN_TEXT) {
        loader.stop();
        onResult(null);
        return;
      }
      loader.request(false, () => fetcher(params, query).then((list) => ({ query, list })));
    },
    stop() {
      loader.stop();
    },
  };
}

/** The rows to show for the text in the box: none while the list answers older text. */
export function listForText(text: string, result: SuggestionResult | null): SearchSuggestion[] | null {
  return result && result.query === text.trim() ? result.list : null;
}

/** Suggestions for the typed text, or null while there are none to show. */
export function useSearchSuggestions(
  filter: ServerFilter,
  text: string,
  focused: boolean,
): SearchSuggestion[] | null {
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const loader = useRef<SuggestionLoader | null>(null);
  if (!loader.current) loader.current = createSuggestionLoader(getSearchSuggestions, setResult);
  const current = loader.current;
  const allServers = !isSavedTab(filter);
  // The box's own text is sent separately, so only a change to another filter asks again.
  const restKey = JSON.stringify({ ...filter, search: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rest = useMemo(() => ({ ...filterParamsFor(filter), search: null }), [restKey]);

  useEffect(() => {
    current.update(focused, allServers, rest, text);
  }, [current, focused, allServers, rest, text]);

  useEffect(() => () => current.stop(), [current]);

  return listForText(text, result);
}
