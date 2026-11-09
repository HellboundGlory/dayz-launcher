import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServerFilter } from "@/types/filters";

const filterBase = {
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
  official: null,
  modded: null,
  first_person: null,
  mod_ids: [],
  mod_match: "any",
  mod_ids_exclude: [],
  version: null,
  time_of_day: null,
  battleye: null,
} satisfies ServerFilter;

const { mockStore, useServerStore, DEFAULT_FILTER } = vi.hoisted(() => {
  const defaults = {
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
  const store = {
    filter: undefined as unknown as ServerFilter,
    maps: [] as [string, string][],
    setFilter: vi.fn(),
    resetFilter: vi.fn(),
  };
  const hook = Object.assign(
    (selector: (s: typeof store) => unknown) => selector(store),
    { getState: () => store },
  );
  return { mockStore: store, useServerStore: hook, DEFAULT_FILTER: defaults };
});

vi.mock("@/stores/server-store", () => ({ useServerStore, DEFAULT_FILTER }));

const versionHook = vi.hoisted(() => ({
  useInstalledDayzVersion: vi.fn(() => null as string | null),
  useFilterFacets: vi.fn(() => ({ facets: null, facetError: false, installedVersion: null })),
}));
vi.mock("@/hooks/use-filter-facets", () => versionHook);

const viewport = vi.hoisted(() => ({ useViewportWidth: vi.fn(() => 1400) }));
vi.mock("../renderer/use-viewport-width", () => viewport);

const captured = new Map<string, Record<string, unknown>[]>();
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") {
        if (!captured.has(part)) captured.set(part, []);
        captured.get(part)!.push(props);
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

import { activeFilterChips, chipLabel, FilterChips, foldChips } from "./filter-chips";
import { activeFilterCount } from "@/lib/filter-summary";

const maps: [string, string][] = [
  ["chernarusplus", "Chernarus"],
  ["namalsk", "Namalsk"],
];

const withFilter = (patch: Partial<ServerFilter>): ServerFilter => ({ ...filterBase, ...patch });
const parts = (name: string) => captured.get(name) ?? [];

beforeEach(() => {
  mockStore.filter = withFilter({});
  mockStore.maps = maps;
  mockStore.setFilter.mockReset();
  mockStore.setFilter.mockImplementation((patch: Partial<ServerFilter>) => {
    mockStore.filter = { ...mockStore.filter, ...patch };
  });
  mockStore.resetFilter.mockReset();
  viewport.useViewportWidth.mockReturnValue(1400);
  versionHook.useInstalledDayzVersion.mockReturnValue(null);
  captured.clear();
});

describe("activeFilterChips", () => {
  const rows: {
    name: string;
    patch: Partial<ServerFilter>;
    key: string;
    prefix: string;
    value: string;
    clear: Partial<ServerFilter>;
  }[] = [
    { name: "map", patch: { maps: ["namalsk"] }, key: "maps", prefix: "Map", value: "Namalsk", clear: { maps: [] } },
    {
      name: "version",
      patch: { version: "1.29.163709" },
      key: "version",
      prefix: "Version",
      value: "1.29.163709",
      clear: { version: null },
    },
    {
      name: "country",
      patch: { countries: ["DE"] },
      key: "countries",
      prefix: "Country",
      value: "Germany",
      clear: { countries: [] },
    },
    { name: "official", patch: { official: true }, key: "official", prefix: "", value: "Official", clear: { official: null } },
    {
      name: "community",
      patch: { official: false },
      key: "official",
      prefix: "",
      value: "Community",
      clear: { official: null },
    },
    { name: "ping", patch: { max_ping: 100 }, key: "max_ping", prefix: "Ping", value: "under 100 ms", clear: { max_ping: null } },
    {
      name: "hide offline",
      patch: { hide_offline: true },
      key: "hide_offline",
      prefix: "",
      value: "Hide offline",
      clear: { hide_offline: false },
    },
    {
      name: "1PP",
      patch: { first_person: true },
      key: "first_person",
      prefix: "",
      value: "1PP only",
      clear: { first_person: null },
    },
    {
      name: "3PP",
      patch: { first_person: false },
      key: "first_person",
      prefix: "",
      value: "3PP allowed",
      clear: { first_person: null },
    },
    {
      name: "day",
      patch: { time_of_day: "day" },
      key: "time_of_day",
      prefix: "Time",
      value: "Day",
      clear: { time_of_day: null },
    },
    { name: "modded", patch: { modded: true }, key: "modded", prefix: "", value: "Modded", clear: { modded: null } },
    { name: "vanilla", patch: { modded: false }, key: "modded", prefix: "", value: "Vanilla", clear: { modded: null } },
    {
      name: "mods",
      patch: { mod_ids: ["1", "2"], mod_ids_exclude: ["3"] },
      key: "mods",
      prefix: "Mods",
      value: "2 in, 1 out",
      clear: { mod_ids: [], mod_ids_exclude: [] },
    },
    {
      name: "no password",
      patch: { hide_locked: true },
      key: "hide_locked",
      prefix: "",
      value: "No password",
      clear: { hide_locked: false },
    },
    {
      name: "BattlEye",
      patch: { battleye: true },
      key: "battleye",
      prefix: "",
      value: "BattlEye on",
      clear: { battleye: null },
    },
    {
      name: "BattlEye off",
      patch: { battleye: false },
      key: "battleye",
      prefix: "",
      value: "BattlEye off",
      clear: { battleye: null },
    },
    {
      name: "hide empty",
      patch: { hide_empty: true },
      key: "hide_empty",
      prefix: "",
      value: "Hide empty",
      clear: { hide_empty: false },
    },
    {
      name: "hide full",
      patch: { hide_full: true },
      key: "hide_full",
      prefix: "",
      value: "Hide full",
      clear: { hide_full: false },
    },
  ];

  it.each(rows)("$name reads its prefix and value, and clears its field", ({ patch, key, prefix, value, clear }) => {
    const [chip] = activeFilterChips(withFilter(patch), maps, null);
    expect(chip).toEqual({ key, prefix, value, clear });
  });

  it.each(rows)("$name gives one chip, the same count the badge shows", ({ patch }) => {
    const filter = withFilter(patch);
    expect(activeFilterChips(filter, maps, null)).toHaveLength(activeFilterCount(filter));
  });

  it("gives no chip for the search text or the tab flags", () => {
    expect(activeFilterChips(withFilter({ search: "namalsk" }), maps, null)).toEqual([]);
    expect(activeFilterChips(withFilter({ favourites_only: true }), maps, null)).toEqual([]);
    expect(activeFilterChips(withFilter({ recent_only: true }), maps, null)).toEqual([]);
  });

  it("reads Same as mine when the version is the installed one", () => {
    const [chip] = activeFilterChips(withFilter({ version: "1.29.163709" }), maps, "1.29.163709");
    expect(chip.value).toBe("Same as mine");
  });

  it("keeps the menu's order", () => {
    const filter = withFilter({
      maps: ["namalsk"],
      version: "1.29.163709",
      countries: ["EU"],
      official: true,
      max_ping: 50,
      hide_offline: true,
      first_person: true,
      time_of_day: "night",
      modded: false,
      mod_ids: ["1"],
      hide_locked: true,
      battleye: true,
      hide_empty: true,
      hide_full: true,
    });
    expect(activeFilterChips(filter, maps, null).map((chip) => chip.key)).toEqual([
      "maps",
      "version",
      "countries",
      "official",
      "max_ping",
      "hide_offline",
      "first_person",
      "time_of_day",
      "modded",
      "mods",
      "hide_locked",
      "battleye",
      "hide_empty",
      "hide_full",
    ]);
  });

  it("names a chip with its prefix only when it has one", () => {
    expect(chipLabel({ key: "maps", prefix: "Map", value: "Chernarus", clear: {} })).toBe("Map Chernarus");
    expect(chipLabel({ key: "hide_full", prefix: "", value: "Hide full", clear: {} })).toBe("Hide full");
  });
});

describe("foldChips", () => {
  const base = { moreWidth: 70, clearWidth: 60, gap: 6 };

  it("shows every chip with Clear all when they fit", () => {
    expect(foldChips({ ...base, chipWidths: [80, 90], available: 500 })).toEqual({ shown: 2, showClear: true });
  });

  it("drops Clear all before folding any chip", () => {
    expect(foldChips({ ...base, chipWidths: [80, 90], available: 200 })).toEqual({ shown: 2, showClear: false });
  });

  it("folds the chips that don't fit beside +N more", () => {
    expect(foldChips({ ...base, chipWidths: [100, 100, 100, 100], available: 300 })).toEqual({
      shown: 2,
      showClear: false,
    });
  });

  it("shows no chip when not even one fits beside +N more", () => {
    expect(foldChips({ ...base, chipWidths: [300], available: 200 })).toEqual({ shown: 0, showClear: false });
  });
});

describe("FilterChips", () => {
  it("renders nothing with no filter on", () => {
    expect(renderToStaticMarkup(<FilterChips />)).toBe("");
  });

  it("renders nothing on the Favourites and Recent tabs", () => {
    mockStore.filter = withFilter({ hide_full: true, favourites_only: true });
    expect(renderToStaticMarkup(<FilterChips />)).toBe("");
    mockStore.filter = withFilter({ hide_full: true, recent_only: true });
    expect(renderToStaticMarkup(<FilterChips />)).toBe("");
  });

  it("renders nothing at a narrow width", () => {
    mockStore.filter = withFilter({ hide_full: true });
    viewport.useViewportWidth.mockReturnValue(650);
    expect(renderToStaticMarkup(<FilterChips />)).toBe("");
  });

  it("shows each chip with its prefix, value, title and remove label", () => {
    mockStore.filter = withFilter({ maps: ["namalsk"], hide_full: true });
    const html = renderToStaticMarkup(<FilterChips />);
    expect(html).toContain('data-el="filter.chips"');
    expect(html).toContain("Map");
    expect(html).toContain("Namalsk");
    expect(html).toContain('title="Map Namalsk"');
    expect(html).toContain('aria-label="Remove filter: Map Namalsk"');
    expect(html).toContain('aria-label="Remove filter: Hide full"');
    expect(html).toContain("Clear all");
  });

  it("removes the filter the chip stands for", () => {
    mockStore.filter = withFilter({ maps: ["namalsk"], hide_full: true });
    renderToStaticMarkup(<FilterChips />);
    const remove = parts("remove").find((props) => props["aria-label"] === "Remove filter: Hide full");
    expect(remove).toBeDefined();
    (remove!.onClick as () => void)();
    expect(mockStore.setFilter).toHaveBeenCalledWith({ hide_full: false });
  });

  it("keeps the search text when Clear all runs", () => {
    mockStore.filter = withFilter({ hide_full: true, search: "namalsk" });
    renderToStaticMarkup(<FilterChips />);
    const clearAll = parts("clearAll")[0];
    expect(clearAll).toBeDefined();
    (clearAll.onClick as () => void)();
    expect(mockStore.filter.search).toBe("namalsk");
    expect(mockStore.filter.hide_full).toBe(false);
  });
});
