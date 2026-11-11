import { useRef, type RefObject } from "react";
import type { SearchSuggestion } from "@/lib/tauri";
import type { ServerFilter } from "@/types/filters";
import { useAnchoredPopup } from "../interaction/use-anchored-popup";

export type SuggestionKey = "ArrowDown" | "ArrowUp";

/** The row the arrow key moves to, wrapping at either end; -1 means none is active. */
export function nextActive(index: number, key: SuggestionKey, length: number): number {
  if (length === 0) return -1;
  if (index < 0) return key === "ArrowDown" ? 0 : length - 1;
  const step = key === "ArrowDown" ? 1 : -1;
  return (index + step + length) % length;
}

/** The filter a picked suggestion adds, without doubles and with the search text cleared. */
export function suggestionPatch(filter: ServerFilter, suggestion: SearchSuggestion): Partial<ServerFilter> {
  const withValues = (current: string[]) => [...new Set([...current, ...suggestion.values])];
  switch (suggestion.kind) {
    case "map":
      return { maps: withValues(filter.maps), search: null };
    case "mod": {
      // A row counts servers running any of its ids, so under "all" requiring every id would match almost nothing.
      const ids = filter.mod_match === "all" ? suggestion.values.slice(0, 1) : suggestion.values;
      const patch: Partial<ServerFilter> = { mod_ids: [...new Set([...filter.mod_ids, ...ids])], search: null };
      if (filter.mod_ids_exclude.some((id) => ids.includes(id))) {
        patch.mod_ids_exclude = filter.mod_ids_exclude.filter((id) => !ids.includes(id));
      }
      return patch;
    }
    case "version":
      return { version: suggestion.values[0] ?? null, search: null };
  }
}

export interface MatchSplit {
  before: string;
  match: string;
  after: string;
}

const WORD_BOUNDARY = new Set([" ", "-", "_", "[", "(", ".", "/"]);

/** The typed text inside a label, at a word start when there is one. */
export function splitMatch(label: string, text: string): MatchSplit | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  const haystack = label.toLowerCase();
  let fallback = -1;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (at === 0 || WORD_BOUNDARY.has(haystack[at - 1])) {
      return { before: label.slice(0, at), match: label.slice(at, at + needle.length), after: label.slice(at + needle.length) };
    }
    if (fallback === -1) fallback = at;
  }
  if (fallback === -1) return null;
  return {
    before: label.slice(0, fallback),
    match: label.slice(fallback, fallback + needle.length),
    after: label.slice(fallback + needle.length),
  };
}

const KIND_LABEL: Record<SearchSuggestion["kind"], string> = {
  map: "Map",
  mod: "Mod",
  version: "Version",
};

/** Id for a row, so the combobox can point at it. */
export function suggestionId(index: number): string {
  return `search-suggestion-${index}`;
}

export function SearchSuggestions({
  id,
  triggerRef,
  text,
  suggestions,
  activeIndex,
  onPick,
}: {
  id?: string;
  triggerRef: RefObject<HTMLElement | null>;
  text: string;
  suggestions: SearchSuggestion[];
  activeIndex: number;
  onPick: (suggestion: SearchSuggestion) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const style = useAnchoredPopup(true, triggerRef, listRef, { side: "bottom", align: "start", offset: 2 });
  const capped = typeof window === "undefined" ? 420 : Math.min(420, window.innerWidth - 16);

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={listRef}
      data-part="suggestions"
      className="flex flex-col overflow-hidden border border-line bg-surface shadow-lg"
      style={{ ...style, width: capped }}
    >
      <div id={id} role="listbox" aria-label="Search suggestions" className="flex flex-col">
      {suggestions.map((suggestion, index) => {
        const split = splitMatch(suggestion.label, text);
        const active = index === activeIndex;
        return (
          <button
            key={`${suggestion.kind}-${suggestion.label}`}
            type="button"
            role="option"
            tabIndex={-1}
            id={suggestionId(index)}
            aria-selected={active}
            data-part="suggestion"
            data-state={active ? "active" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(suggestion)}
            className="grid grid-cols-[52px_1fr_auto] items-center gap-2.5 px-3 py-1.5 text-left text-ink data-[state=active]:bg-accent-soft"
          >
            <span data-part="kind" className="text-muted">
              {KIND_LABEL[suggestion.kind]}
            </span>
            <span className="truncate">
              {split ? (
                <>
                  {split.before}
                  <mark data-part="match" className="bg-transparent font-semibold text-accent">
                    {split.match}
                  </mark>
                  {split.after}
                </>
              ) : (
                suggestion.label
              )}
            </span>
            <span data-part="count" className="[font-family:var(--t-type-family-data)] text-muted2">
              {suggestion.count.toLocaleString("en")} servers
            </span>
          </button>
        );
      })}
      </div>
      <div data-part="hint" className="border-t border-line px-3 py-2 text-muted">
        Choose one to add it as a filter, or press Enter to search names for &quot;{text.trim()}&quot;.
      </div>
    </div>
  );
}
