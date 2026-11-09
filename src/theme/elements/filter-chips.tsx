import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { useServerStore } from "@/stores/server-store";
import type { ServerFilter } from "@/types/filters";
import { useInstalledDayzVersion } from "@/hooks/use-filter-facets";
import { useViewportWidth } from "../renderer/use-viewport-width";
import { countryDisplayValue, mapDisplayValue } from "./popup-elements";
import { modsFilterValue } from "./filter-elements";
import { NARROW_MENU_WIDTH, resetKeepingSearch } from "./filter-menu";

export interface FilterChip {
  key: string;
  prefix: string;
  value: string;
  clear: Partial<ServerFilter>;
}

export function activeFilterChips(
  filter: ServerFilter,
  maps: [string, string][],
  installedVersion: string | null,
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filter.maps.length > 0) {
    chips.push({ key: "maps", prefix: "Map", value: mapDisplayValue(filter.maps, maps), clear: { maps: [] } });
  }
  if (filter.version !== null) {
    const same = installedVersion !== null && filter.version === installedVersion;
    chips.push({
      key: "version",
      prefix: "Version",
      value: same ? "Same as mine" : filter.version,
      clear: { version: null },
    });
  }
  if (filter.countries.length > 0) {
    chips.push({
      key: "countries",
      prefix: "Country",
      value: countryDisplayValue(filter.countries),
      clear: { countries: [] },
    });
  }
  if (filter.official !== null) {
    chips.push({
      key: "official",
      prefix: "",
      value: filter.official ? "Official" : "Community",
      clear: { official: null },
    });
  }
  if (filter.max_ping !== null) {
    chips.push({ key: "max_ping", prefix: "Ping", value: `under ${filter.max_ping} ms`, clear: { max_ping: null } });
  }
  if (filter.hide_offline) {
    chips.push({ key: "hide_offline", prefix: "", value: "Hide offline", clear: { hide_offline: false } });
  }
  if (filter.first_person !== null) {
    chips.push({
      key: "first_person",
      prefix: "",
      value: filter.first_person ? "1PP only" : "3PP allowed",
      clear: { first_person: null },
    });
  }
  if (filter.time_of_day !== null) {
    chips.push({
      key: "time_of_day",
      prefix: "Time",
      value: filter.time_of_day === "day" ? "Day" : "Night",
      clear: { time_of_day: null },
    });
  }
  if (filter.modded !== null) {
    chips.push({ key: "modded", prefix: "", value: filter.modded ? "Modded" : "Vanilla", clear: { modded: null } });
  }
  if (filter.mod_ids.length > 0 || filter.mod_ids_exclude.length > 0) {
    chips.push({
      key: "mods",
      prefix: "Mods",
      value: modsFilterValue(filter.mod_ids.length, filter.mod_ids_exclude.length),
      clear: { mod_ids: [], mod_ids_exclude: [] },
    });
  }
  if (filter.hide_locked) {
    chips.push({ key: "hide_locked", prefix: "", value: "No password", clear: { hide_locked: false } });
  }
  if (filter.battleye !== null) {
    chips.push({
      key: "battleye",
      prefix: "",
      value: filter.battleye ? "BattlEye on" : "BattlEye off",
      clear: { battleye: null },
    });
  }
  if (filter.hide_empty) {
    chips.push({ key: "hide_empty", prefix: "", value: "Hide empty", clear: { hide_empty: false } });
  }
  if (filter.hide_full) {
    chips.push({ key: "hide_full", prefix: "", value: "Hide full", clear: { hide_full: false } });
  }
  return chips;
}

export interface ChipFold {
  shown: number;
  showClear: boolean;
}

/** How many chips fit on one line, and whether Clear all keeps its place. */
export function foldChips({
  chipWidths,
  moreWidth,
  clearWidth,
  available,
  gap,
}: {
  chipWidths: number[];
  moreWidth: number;
  clearWidth: number;
  available: number;
  gap: number;
}): ChipFold {
  const all = chipWidths.reduce((total, width) => total + width + gap, 0);
  if (all <= available) {
    return { shown: chipWidths.length, showClear: all + clearWidth <= available };
  }
  let used = 0;
  let shown = 0;
  for (const width of chipWidths) {
    if (used + width + gap + moreWidth > available) break;
    used += width + gap;
    shown++;
  }
  return { shown, showClear: false };
}

/** The chip's text, and how its remove button names it. */
export function chipLabel(chip: FilterChip): string {
  return chip.prefix ? `${chip.prefix} ${chip.value}` : chip.value;
}

const width = (el: Element) => el.getBoundingClientRect().width;

export function FilterChips({ className, style }: { className?: string; style?: CSSProperties }) {
  const filter = useServerStore((s) => s.filter);
  const maps = useServerStore((s) => s.maps);
  const setFilter = useServerStore((s) => s.setFilter);
  const viewportWidth = useViewportWidth();
  const installedVersion = useInstalledDayzVersion();

  const chips = useMemo(
    () => activeFilterChips(filter, maps, installedVersion),
    [filter, maps, installedVersion],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState<ChipFold>({ shown: chips.length, showClear: true });

  const measure = useCallback(() => {
    const root = rootRef.current;
    const strip = measureRef.current;
    if (!root || !strip) return;
    const widths = Array.from(strip.querySelectorAll('[data-part="chip"]')).map(width);
    const more = strip.querySelector('[data-part="more"]');
    const clear = strip.querySelector('[data-part="clearAll"]');
    if (widths.length === 0 || !more || !clear) return;
    // Text widths are fractional; a pixel of slack keeps the last chip from being clipped.
    const next = foldChips({
      chipWidths: widths,
      moreWidth: width(more),
      clearWidth: width(clear),
      available: root.clientWidth - 1,
      gap: parseFloat(getComputedStyle(root).columnGap) || 0,
    });
    setFold((prev) =>
      prev.shown === next.shown && prev.showClear === next.showClear ? prev : next,
    );
  }, []);

  const tabNote = filter.favourites_only || filter.recent_only;
  const narrow = viewportWidth > 0 && viewportWidth < NARROW_MENU_WIDTH;
  const present = chips.length > 0 && !tabNote && !narrow;

  useLayoutEffect(() => {
    measure();
  }, [measure, chips, present]);

  // Keyed on present: the strip is not in the page while it renders nothing.
  useEffect(() => {
    const root = rootRef.current;
    if (!present || !root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure, present]);

  if (!present) return null;

  const shown = Math.min(fold.shown, chips.length);
  const hidden = chips.length - shown;

  const openMenu = () => {
    document.querySelector<HTMLButtonElement>('[data-el="filter.menu"] [data-part="trigger"]')?.click();
  };

  const chipNode = (chip: FilterChip, measurable: boolean) => (
    <span
      key={chip.key}
      data-part="chip"
      title={chipLabel(chip)}
      className="flex h-6 min-w-0 max-w-[260px] shrink-0 items-center gap-1 overflow-hidden border border-line bg-surface2 pl-2 pr-1 text-ink"
    >
      {chip.prefix && (
        <span data-part="prefix" className="shrink-0 text-muted2">
          {chip.prefix}
        </span>
      )}
      <span data-part="value" className="min-w-0 truncate">
        {chip.value}
      </span>
      <button
        type="button"
        data-part="remove"
        aria-label={`Remove filter: ${chipLabel(chip)}`}
        tabIndex={measurable ? -1 : undefined}
        onClick={() => setFilter(chip.clear)}
        className="grid size-[18px] shrink-0 place-items-center text-muted"
      >
        <X aria-hidden="true" className="size-3" />
      </button>
    </span>
  );

  return (
    <div
      ref={rootRef}
      data-el="filter.chips"
      data-state={hidden > 0 ? "folded" : undefined}
      className={className ?? "relative flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap"}
      style={{ position: "relative", ...style }}
    >
      {chips.slice(0, shown).map((chip) => chipNode(chip, false))}
      {hidden > 0 && (
        <button
          type="button"
          data-part="more"
          onClick={openMenu}
          className="h-6 shrink-0 border border-accent-line px-2 text-accent"
        >
          +{hidden} more
        </button>
      )}
      {fold.showClear && (
        <button
          type="button"
          data-part="clearAll"
          onClick={resetKeepingSearch}
          className="shrink-0 text-muted2 underline [text-underline-offset:3px]"
        >
          Clear all
        </button>
      )}
      <div
        ref={measureRef}
        aria-hidden="true"
        data-measure=""
        className="pointer-events-none absolute left-0 top-0 flex items-center whitespace-nowrap opacity-0"
        style={{ visibility: "hidden", gap: "inherit" }}
      >
        {chips.map((chip) => chipNode(chip, true))}
        <button type="button" data-part="more" tabIndex={-1} className="h-6 shrink-0 border px-2">
          +{chips.length} more
        </button>
        <button type="button" data-part="clearAll" tabIndex={-1} className="shrink-0 underline">
          Clear all
        </button>
      </div>
    </div>
  );
}
