import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServerFilter } from "@/types/filters";
import { ElementContextProvider } from "./context";

function makeFilter(overrides: Partial<ServerFilter> = {}): ServerFilter {
  return {
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
    ...overrides,
  };
}

const mockStore = {
  filter: makeFilter(),
  maps: [] as [string, string][],
  sortKey: "players" as "players" | "ping" | "mod_count" | "name" | "map" | "last_played",
  sortDir: "desc" as "asc" | "desc",
  setFilter: vi.fn((patch: Partial<ServerFilter>) => Object.assign(mockStore.filter, patch)),
  setSort: vi.fn((key: typeof mockStore.sortKey, dir: typeof mockStore.sortDir) => {
    mockStore.sortKey = key;
    mockStore.sortDir = dir;
  }),
  resetFilter: vi.fn(),
};

vi.mock("@/stores/server-store", () => ({
  useServerStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
}));

vi.mock("../theme-store", () => ({
  useLayoutSubscription: () => {},
  getThemeOwnedLayout: () => undefined,
}));

// Captures a button's props as it is created, since renderToStaticMarkup
// discards event handlers from its HTML output.
let capturedProps: Record<string, unknown> | null = null;
let captureDataEl: string | null = null;

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (captureDataEl && props["data-el"] === captureDataEl) {
        capturedProps = props;
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

import {
  FilterSearch,
  FilterMap,
  FilterTags,
  FilterRegion,
  FilterSort,
  FilterMaxPing,
  FilterMods,
  FilterHideEmpty,
  FilterHideFull,
  FilterHideLocked,
  FilterHideOffline,
  FilterReset,
  ServersRefresh,
  REGIONS,
  mapDisplayValue,
  tagsDisplayValue,
  cycleTagValue,
  regionDisplayValue,
  toggleInList,
  pingDisplayValue,
  pingSliderValue,
  nextPingFilter,
  modsFilterValue,
} from "./filter-elements";

beforeEach(() => {
  mockStore.filter = makeFilter();
  mockStore.maps = [];
  mockStore.sortKey = "players";
  mockStore.sortDir = "desc";
  capturedProps = null;
  captureDataEl = null;
});

describe("mapDisplayValue", () => {
  const cases: { selected: string[]; maps: [string, string][]; value: string }[] = [
    { selected: [], maps: [], value: "Any" },
    { selected: ["chernarusplus"], maps: [["chernarusplus", "Chernarus"]], value: "Chernarus" },
    { selected: ["a", "b", "c"], maps: [], value: "3 maps" },
  ];

  it.each(cases)("maps $selected.length selected to $value", ({ selected, maps, value }) => {
    expect(mapDisplayValue(selected, maps)).toBe(value);
  });
});

describe("tagsDisplayValue and cycleTagValue", () => {
  it.each([
    { active: 0, value: "Any" },
    { active: 1, value: "1 tag" },
    { active: 2, value: "2 tags" },
  ])("reads $value with $active active", ({ active, value }) => {
    expect(tagsDisplayValue(active)).toBe(value);
  });

  it("cycles null -> true -> false -> null", () => {
    expect(cycleTagValue(null)).toBe(true);
    expect(cycleTagValue(true)).toBe(false);
    expect(cycleTagValue(false)).toBeNull();
  });
});

describe("regionDisplayValue and toggleInList", () => {
  it("uses EU/NA/AS/OC/SA region codes, not country codes", () => {
    expect(REGIONS.map((r) => r.code)).toEqual(["EU", "NA", "AS", "OC", "SA"]);
  });

  it.each([
    { selected: [] as string[], value: "Any" },
    { selected: ["EU"], value: "Europe" },
    { selected: ["EU", "NA"], value: "2 regions" },
  ])("reads $value with $selected.length selected", ({ selected, value }) => {
    expect(regionDisplayValue(selected)).toBe(value);
  });

  it("toggles a code into and out of the list", () => {
    expect(toggleInList([], "EU")).toEqual(["EU"]);
    expect(toggleInList(["EU"], "EU")).toEqual([]);
    expect(toggleInList(["EU"], "NA")).toEqual(["EU", "NA"]);
  });
});

describe("ping helpers", () => {
  it.each([
    { maxPing: null, slider: 500, value: "Any", next: null },
    { maxPing: 250, slider: 250, value: "250ms", next: 250 },
  ])("maps $maxPing to the slider, its label and back", ({ maxPing, slider, value, next }) => {
    expect(pingSliderValue(maxPing)).toBe(slider);
    expect(pingDisplayValue(maxPing)).toBe(value);
    expect(nextPingFilter(slider)).toBe(next);
  });
});

describe("FilterSearch", () => {
  it("renders the icon and input parts, and the filled state with a search term", () => {
    const empty = renderToStaticMarkup(<FilterSearch />);
    expect(empty).toContain('data-el="filter.search"');
    expect(empty).toContain('data-part="icon"');
    expect(empty).toContain('data-part="input"');
    expect(empty).not.toContain('data-state="filled"');

    mockStore.filter.search = "chernarus";
    expect(renderToStaticMarkup(<FilterSearch />)).toContain('data-state="filled"');
  });

  it("honours the showIcon and icon options", () => {
    const noIcon = renderToStaticMarkup(<FilterSearch options={{ showIcon: false }} />);
    expect(noIcon).not.toContain('data-part="icon"');

    expect(renderToStaticMarkup(<FilterSearch options={{ icon: "globe" }} />)).toContain("lucide-globe");
  });
});

describe("FilterMap", () => {
  it("is active only while maps are selected", () => {
    const none = renderToStaticMarkup(<FilterMap />);
    expect(none).toContain('data-el="filter.map"');
    expect(none).not.toContain('data-state="active"');

    mockStore.filter.maps = ["chernarusplus"];
    mockStore.maps = [["chernarusplus", "Chernarus"]];
    expect(renderToStaticMarkup(<FilterMap />)).toContain('data-state="active"');
  });
});

describe("FilterTags", () => {
  it("is active only while a tag filter is set", () => {
    const none = renderToStaticMarkup(<FilterTags />);
    expect(none).toContain('data-el="filter.tags"');
    expect(none).not.toContain('data-state="active"');

    mockStore.filter.official = true;
    mockStore.filter.modded = false;
    const html = renderToStaticMarkup(<FilterTags />);
    expect(html).toContain('data-state="active"');
    expect(html).toContain("2 tags");
  });
});

describe("FilterRegion", () => {
  it("is active only while regions are selected", () => {
    const none = renderToStaticMarkup(<FilterRegion />);
    expect(none).toContain('data-el="filter.region"');
    expect(none).not.toContain('data-state="active"');

    mockStore.filter.countries = ["EU", "NA"];
    expect(renderToStaticMarkup(<FilterRegion />)).toContain('data-state="active"');
  });

  it("honours a label option override", () => {
    const html = renderToStaticMarkup(<FilterRegion options={{ label: "Country" }} />);
    expect(html).toContain(">Country<");
  });
});

describe("FilterSort", () => {
  it.each([
    { sortKey: "players", sortDir: "desc", active: false, value: "Players", direction: "↓" },
    { sortKey: "ping", sortDir: "desc", active: true, value: "Ping", direction: "↓" },
    { sortKey: "players", sortDir: "asc", active: true, value: "Players", direction: "↑" },
  ] as const)(
    "shows $sortKey $sortDir with active=$active and direction $direction",
    ({ sortKey, sortDir, active, value, direction }) => {
      mockStore.sortKey = sortKey;
      mockStore.sortDir = sortDir;
      const html = renderToStaticMarkup(<FilterSort />);
      expect(html).toContain('data-el="filter.sort"');
      expect(html.includes('data-state="active"')).toBe(active);
      expect(html).toContain(`>${value}<`);
      expect(html).toContain(direction);
    },
  );

  it("honours the showLabel and label options", () => {
    expect(renderToStaticMarkup(<FilterSort />)).toContain('data-part="label"');

    const noLabel = renderToStaticMarkup(<FilterSort options={{ showLabel: false }} />);
    expect(noLabel).not.toContain('data-part="label"');

    const custom = renderToStaticMarkup(<FilterSort options={{ label: "ORDER" }} />);
    expect(custom).toContain(">ORDER<");
  });
});

describe("FilterMaxPing", () => {
  it("is active only with a ping limit", () => {
    const unset = renderToStaticMarkup(<FilterMaxPing />);
    expect(unset).toContain('data-el="filter.maxPing"');
    expect(unset).not.toContain('data-state="active"');

    mockStore.filter.max_ping = 250;
    expect(renderToStaticMarkup(<FilterMaxPing />)).toContain('data-state="active"');
  });
});

describe("hide toggles", () => {
  const toggles = [
    { el: "filter.hideEmpty", node: <FilterHideEmpty />, field: "hide_empty" as const },
    { el: "filter.hideFull", node: <FilterHideFull />, field: "hide_full" as const },
    { el: "filter.hideLocked", node: <FilterHideLocked />, field: "hide_locked" as const },
    { el: "filter.hideOffline", node: <FilterHideOffline />, field: "hide_offline" as const },
  ];

  it.each(toggles)("$el is off until its filter field is set", ({ el, node, field }) => {
    const off = renderToStaticMarkup(node);
    expect(off).toContain(`data-el="${el}"`);
    expect(off).not.toContain('data-state="on"');

    mockStore.filter[field] = true;
    const on = renderToStaticMarkup(node);
    expect(on).toContain('data-state="on"');
    expect(on).toContain('aria-pressed="true"');
  });

  it.each(toggles)("$el flips its own filter field through the store", ({ el, node, field }) => {
    captureDataEl = el;
    renderToStaticMarkup(node);
    (capturedProps?.onClick as () => void)();
    expect(mockStore.setFilter).toHaveBeenCalledWith({ [field]: true });
  });

  it.each(["checkbox", "switch"] as const)(
    "renders a focusable button with role=%s and aria-checked",
    (control) => {
      const html = renderToStaticMarkup(<FilterHideEmpty options={{ control }} />);
      expect(html).toMatch(new RegExp(`<button[^>]*role="${control}"[^>]*aria-checked="false"`));
      expect(html).toContain('data-part="box"');
    },
  );

  it("honours the label and icon options", () => {
    expect(renderToStaticMarkup(<FilterHideEmpty />)).not.toContain('data-part="icon"');

    const html = renderToStaticMarkup(<FilterHideEmpty options={{ label: "No empties", icon: "x" }} />);
    expect(html).toContain("No empties");
    expect(html).toContain('data-part="icon"');
    expect(html).toContain("lucide-x");
  });
});

describe("FilterReset", () => {
  it("calls resetFilter on click", () => {
    captureDataEl = "filter.reset";
    renderToStaticMarkup(<FilterReset />);
    (capturedProps?.onClick as () => void)();
    expect(mockStore.resetFilter).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "default", options: undefined, icon: true, label: true },
    { name: "iconLabel", options: { display: "iconLabel" }, icon: true, label: true },
    { name: "icon", options: { display: "icon" }, icon: true, label: false },
    { name: "label", options: { display: "label" }, icon: false, label: true },
  ])("shows the parts its $name display declares", ({ options, icon, label }) => {
    const html = renderToStaticMarkup(<FilterReset options={options} />);
    expect(html).toContain('data-el="filter.reset"');
    expect(html.includes('data-part="icon"')).toBe(icon);
    expect(html.includes('data-part="label"')).toBe(label);
  });

  it("honours the label and icon options", () => {
    const custom = renderToStaticMarkup(<FilterReset options={{ label: "Clear filters" }} />);
    expect(custom).toContain("Clear filters");

    expect(renderToStaticMarkup(<FilterReset options={{ icon: "x" }} />)).toContain("lucide-x");
  });
});

describe("modsFilterValue", () => {
  it.each([
    { included: 0, excluded: 0, value: "Any" },
    { included: 1, excluded: 0, value: "1 mod" },
    { included: 2, excluded: 0, value: "2 mods" },
    { included: 0, excluded: 3, value: "3 excluded" },
    { included: 2, excluded: 1, value: "2 in, 1 out" },
  ])("reads $value for $included in / $excluded out", ({ included, excluded, value }) => {
    expect(modsFilterValue(included, excluded)).toBe(value);
  });
});

describe("FilterMods", () => {
  it("is active only while mods are filtered", () => {
    const none = renderToStaticMarkup(<FilterMods />);
    expect(none).toContain('data-el="filter.mods"');
    expect(none).not.toContain('data-state="active"');
    expect(none).toContain('data-part="value"');

    mockStore.filter = makeFilter({ mod_ids: ["1", "2"] });
    const selected = renderToStaticMarkup(<FilterMods />);
    expect(selected).toContain('data-state="active"');
    expect(selected).toMatch(/data-part="value"[^>]*>2 mods</);
  });

  it("reflects modFilterOpen through aria-expanded", () => {
    const open = renderToStaticMarkup(
      <ElementContextProvider value={{ modFilterOpen: true }}>
        <FilterMods />
      </ElementContextProvider>,
    );
    expect(open).toContain('aria-expanded="true"');

    const closed = renderToStaticMarkup(
      <ElementContextProvider value={{ modFilterOpen: false }}>
        <FilterMods />
      </ElementContextProvider>,
    );
    expect(closed).toContain('aria-expanded="false"');
  });

  it("calls context openModFilter when clicked", () => {
    const openModFilter = vi.fn();
    captureDataEl = "filter.mods";
    renderToStaticMarkup(
      <ElementContextProvider value={{ openModFilter }}>
        <FilterMods />
      </ElementContextProvider>,
    );
    (capturedProps?.onClick as () => void)?.();
    expect(openModFilter).toHaveBeenCalledTimes(1);
  });

  it("honours the showLabel and label options", () => {
    expect(renderToStaticMarkup(<FilterMods />)).toContain('data-part="label"');

    const noLabel = renderToStaticMarkup(<FilterMods options={{ showLabel: false }} />);
    expect(noLabel).not.toContain('data-part="label"');

    const customLabel = renderToStaticMarkup(<FilterMods options={{ label: "WORKSHOP" }} />);
    expect(customLabel).toContain(">WORKSHOP<");
  });
});

describe("ServersRefresh", () => {
  it("calls context onRefresh when clicked", () => {
    const onRefresh = vi.fn();
    captureDataEl = "servers.refresh";
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ onRefresh, refreshing: false }}>
        <ServersRefresh />
      </ElementContextProvider>,
    );
    expect(html).not.toContain('data-state="busy"');
    (capturedProps?.onClick as () => void)?.();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the busy state and is disabled while refreshing", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ onRefresh: vi.fn(), refreshing: true }}>
        <ServersRefresh />
      </ElementContextProvider>,
    );
    expect(html).toContain('data-el="servers.refresh"');
    expect(html).toContain('data-state="busy"');
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Refreshing…");
  });

  it("honours the icon option", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ onRefresh: vi.fn(), refreshing: false }}>
        <ServersRefresh options={{ icon: "check" }} />
      </ElementContextProvider>,
    );
    expect(html).toContain("lucide-check");
  });
});
