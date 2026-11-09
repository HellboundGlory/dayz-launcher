import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServerFilter } from "@/types/filters";
import type { FilterFacets } from "@/lib/tauri";
import { ElementContextProvider } from "./context";

const makeFilter = (overrides: Partial<ServerFilter> = {}): ServerFilter => ({
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
  ...overrides,
});

const facets: FilterFacets = {
  total: 3010,
  maps: [{ name: "Chernarus", count: 8412, values: ["chernarusplus"] }],
  versions: [{ name: "1.29.163709", count: 19870, values: ["1.29.163709"] }],
  countries: [],
  mods: [],
  same_as_mine: 19870,
};

const { mockStore, useServerStore } = vi.hoisted(() => {
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
  return { mockStore: store, useServerStore: hook };
});

vi.mock("@/stores/server-store", () => ({ useServerStore }));

const facetsHook = vi.hoisted(() => ({
  useFilterFacets: vi.fn(
    (): { facets: FilterFacets | null; facetError: boolean; installedVersion: string | null } => ({
      facets: null,
      facetError: false,
      installedVersion: null,
    }),
  ),
}));
vi.mock("@/hooks/use-filter-facets", () => facetsHook);

vi.mock("../theme-store", () => ({
  useLayoutSubscription: () => {},
  getThemeOwnedLayout: () => undefined,
}));

// renderToStaticMarkup drops event handlers from its HTML, so capture them at
// creation, one list per data-part (same pattern as filter-elements.test.tsx).
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

import {
  FilterMenu,
  FilterMenuDataContext,
  FilterMenuPopup,
  VersionOptions,
  mapCounts,
  renderFilterMenuElement,
  focusSelectRow,
  handleListEscape,
  pickVersion,
} from "./filter-menu";
import { PopupMapOptions } from "./popup-elements";

const group = (element: string, context: { openModFilter?: () => void } = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={context}>
      {renderFilterMenuElement({ element }, {})}
    </ElementContextProvider>,
  );

const parts = (name: string) => captured.get(name) ?? [];

beforeEach(() => {
  mockStore.filter = makeFilter();
  mockStore.maps = [];
  mockStore.setFilter.mockReset();
  mockStore.setFilter.mockImplementation((patch: Partial<ServerFilter>) => {
    mockStore.filter = { ...mockStore.filter, ...patch };
  });
  mockStore.resetFilter.mockReset();
  mockStore.resetFilter.mockImplementation(() => {
    mockStore.filter = makeFilter({ favourites_only: mockStore.filter.favourites_only });
  });
  captured.clear();
  facetsHook.useFilterFacets.mockReturnValue({ facets: null, facetError: false, installedVersion: null });
});

describe("mapCounts", () => {
  it("adds each facet row's count to every map key it stands for", () => {
    expect(
      mapCounts({
        ...facets,
        maps: [
          { name: "Chernarus", count: 8412, values: ["chernarusplus"] },
          { name: "Livonia", count: 100, values: ["enoch", "enochgloom"] },
        ],
      }),
    ).toEqual({ chernarusplus: 8412, enoch: 100, enochgloom: 100 });
  });

  it("has no counts until the facets arrive", () => {
    expect(mapCounts(null)).toBeUndefined();
  });
});

describe("FilterMenu", () => {
  it("shows the badge count while any filter is on", () => {
    const off = renderToStaticMarkup(<FilterMenu />);
    expect(off).toContain('data-el="filter.menu"');
    expect(off).not.toContain('data-part="badge"');
    expect(off).not.toContain('data-state="active"');

    mockStore.filter = makeFilter({ max_ping: 100, hide_empty: true });
    const on = renderToStaticMarkup(<FilterMenu />);
    expect(on).toContain('data-state="active"');
    expect(on).toMatch(/data-part="badge"[^>]*>2</);
  });

  it("honours the label and showLabel options", () => {
    expect(renderToStaticMarkup(<FilterMenu />)).toContain(">Filters<");
    expect(renderToStaticMarkup(<FilterMenu options={{ label: "SEARCH" }} />)).toContain(">SEARCH<");
    expect(renderToStaticMarkup(<FilterMenu options={{ showLabel: false }} />)).not.toContain('data-part="label"');
  });

  it("shows only a note on the Favourites and Recent tabs", () => {
    mockStore.filter = makeFilter({ favourites_only: true });
    const fav = renderToStaticMarkup(<FilterMenu />);
    expect(fav).toContain('data-state="tabNote"');
    expect(fav).toContain("Filters only apply to All servers");
    expect(fav).not.toContain('data-part="trigger"');

    mockStore.filter = makeFilter({ recent_only: true });
    expect(renderToStaticMarkup(<FilterMenu />)).toContain('data-state="tabNote"');
  });
});

describe("segmented choices", () => {
  const rows = [
    { element: "popup.filterServer", label: "Server type", pick: "Official", patch: { official: true } },
    { element: "popup.filterConnection", label: "Ping (ms)", pick: "< 50", patch: { max_ping: 50 } },
    { element: "popup.filterGameplay", label: "Perspective", pick: "1PP only", patch: { first_person: true } },
    { element: "popup.filterGameplay", label: "Time of day", pick: "Night", patch: { time_of_day: "night" } },
    { element: "popup.filterMods", label: "Mods", pick: "Vanilla", patch: { modded: false } },
  ];

  it.each(rows)("$label $pick sets its filter field", ({ element, label, pick, patch }) => {
    group(element);
    const labels = parts("segments").filter((p) => p["aria-label"] === label);
    expect(labels).toHaveLength(1);

    const button = parts("segment").find((p) => p.children === pick);
    expect(button, pick).toBeDefined();
    (button!.onClick as () => void)();
    expect(mockStore.setFilter).toHaveBeenCalledWith(patch);
  });

  it("names the Mods segmented row without an empty label", () => {
    group("popup.filterMods");
    const segments = parts("segments")[0];
    expect(segments["aria-label"]).toBe("Mods");
    expect(parts("label")[0]?.children).toBe("Mods");
  });
});

describe("checkbox rows", () => {
  const rows = [
    { element: "popup.filterConnection", labels: ["Hide offline servers"], patches: [{ hide_offline: true }] },
    { element: "popup.filterAccess", labels: ["No password", "BattlEye on"], patches: [{ hide_locked: true }, { battleye: true }] },
    { element: "popup.filterPlayers", labels: ["Hide empty servers", "Hide full servers"], patches: [{ hide_empty: true }, { hide_full: true }] },
  ];

  it.each(rows)("$element's checkboxes set their fields", ({ element, labels, patches }) => {
    group(element);
    const boxes = parts("checkbox");
    expect(boxes).toHaveLength(labels.length);
    boxes.forEach((box, index) => {
      (box.onClick as () => void)();
      expect(mockStore.setFilter).toHaveBeenLastCalledWith(patches[index]);
    });
  });

  it("clears BattlEye back to null when unchecked", () => {
    mockStore.filter = makeFilter({ battleye: true });
    group("popup.filterAccess");
    (parts("checkbox")[1]?.onClick as () => void)();
    expect(mockStore.setFilter).toHaveBeenLastCalledWith({ battleye: null });
  });
});

describe("mods row", () => {
  it("shows the summary and calls openModFilter", () => {
    mockStore.filter = makeFilter({ mod_ids: ["1", "2"], mod_ids_exclude: ["3"] });
    const openModFilter = vi.fn();
    const html = group("popup.filterMods", { openModFilter });
    expect(html).toContain("2 in, 1 out");

    (parts("select")[0]?.onClick as () => void)();
    expect(openModFilter).toHaveBeenCalledTimes(1);
  });

  it("reads none picked with no mods chosen", () => {
    expect(group("popup.filterMods")).toContain("none picked");
  });
});

describe("footer", () => {
  const footer = (data: { facets: FilterFacets | null; facetError: boolean }) =>
    renderToStaticMarkup(
      <FilterMenuDataContext.Provider value={{ ...data, installedVersion: null, close: () => {} }}>
        {renderFilterMenuElement({ element: "popup.filterFooter" }, {})}
      </FilterMenuDataContext.Provider>,
    );

  it("shows an ellipsis while the first answer is pending", () => {
    const html = footer({ facets: null, facetError: false });
    expect(html).toContain("…");
    expect(html).toContain("servers match");
  });

  it("shows the matching total", () => {
    const html = footer({ facets, facetError: false });
    expect(html).toContain("3,010");
    expect(html).toContain("servers match");
  });

  it("says the count failed instead of a pending ellipsis", () => {
    const html = footer({ facets: null, facetError: true });
    expect(html).toContain("Couldn&#x27;t count servers");
    expect(html).not.toContain("…");
  });
});

describe("pickVersion", () => {
  it("sets the version and closes the list", () => {
    const setFilter = vi.fn();
    const close = vi.fn();
    pickVersion("1.29.163709", setFilter, close);
    expect(setFilter).toHaveBeenCalledWith({ version: "1.29.163709" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(setFilter.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
  });
});

describe("focusSelectRow", () => {
  it("focuses the select inside the row that opened the list", () => {
    const focus = vi.fn();
    const select = { focus };
    const anchor = { querySelector: vi.fn((selector: string) => (selector === '[data-part="select"]' ? select : null)) };
    focusSelectRow(anchor);
    expect(anchor.querySelector).toHaveBeenCalledWith('[data-part="select"]');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the row is gone", () => {
    expect(() => focusSelectRow(null)).not.toThrow();
  });
});

describe("handleListEscape", () => {
  const key = (name: string) => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() });

  it("closes the list and stops the key before the menu sees it", () => {
    const close = vi.fn();
    const event = key("Escape");
    handleListEscape(event, close);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ignores any other key", () => {
    const close = vi.fn();
    const event = key("ArrowDown");
    handleListEscape(event, close);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("VersionOptions", () => {
  it("leaves Same as mine out while the installed version is unknown", () => {
    const html = renderToStaticMarkup(
      <VersionOptions facets={facets} installedVersion={null} picked={null} onPick={() => {}} />,
    );
    expect(html).not.toContain("Same as mine");
    expect(html).toContain("All versions");
  });

  it("shows Same as mine with its count when the version is known", () => {
    const html = renderToStaticMarkup(
      <VersionOptions facets={facets} installedVersion="1.29.163709" picked="1.29.163709" onPick={() => {}} />,
    );
    expect(html).toContain("Same as mine");
    expect(html).toContain("1.29.163709");
    expect(html).toContain("19,870");
  });

  it("shows no count on All versions", () => {
    const html = renderToStaticMarkup(
      <VersionOptions facets={facets} installedVersion={null} picked="1.29.163709" onPick={() => {}} />,
    );
    const allVersions = html.slice(0, html.indexOf("1.29.163709"));
    expect(allVersions).not.toContain('data-part="count"');
  });
});

describe("FilterMenuPopup", () => {
  it("clips on the element carrying the placement, with the body scrolling and the footer outside", () => {
    const html = renderToStaticMarkup(
      <FilterMenuPopup
        popupRef={{ current: null }}
        popupStyle={{ position: "fixed", top: 10 }}
        narrow={false}
        width={600}
      />,
    );
    // The clipping element is the one with the placement and the width.
    expect(html).toMatch(/<div[^>]*data-part="popup"[^>]*style="position:fixed;top:10px;width:600px"/);
    expect(html).toMatch(/data-part="popup"[^>]*class="[^"]*overflow-hidden/);
    // The body scrolls inside it, and the footer sits after the body, not inside it.
    expect(html).toMatch(/data-part="body"[^>]*class="[^"]*min-h-0[^"]*overflow-y-auto/);
    const footer = html.indexOf('data-part="footer"');
    const bodyClose = html.lastIndexOf("</div>", footer);
    expect(bodyClose).toBeGreaterThan(html.indexOf('data-part="body"'));
  });
});

describe("themed element placement", () => {
  it("puts the theme's class and style on the element carrying data-el", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{}}>
        {renderFilterMenuElement({ element: "popup.filterPlayers" }, { className: "theme-group", style: { marginTop: 4 } })}
      </ElementContextProvider>,
    );
    expect(html).toMatch(/data-el="popup\.filterPlayers"[^>]*class="[^"]*theme-group/);
    expect(html).toContain("margin-top:4px");
    expect(html).not.toContain('<div class="theme-group">');
  });

  it("uses the theme's class instead of the default classes", () => {
    for (const element of ["popup.filterPlayers", "popup.filterFooter"]) {
      const html = renderToStaticMarkup(
        <ElementContextProvider value={{}}>
          {renderFilterMenuElement({ element }, { className: "theme-group" })}
        </ElementContextProvider>,
      );
      expect(html).toMatch(new RegExp(`data-el="${element.replace(".", "\\.")}"[^>]*class="theme-group"`));
    }
  });
});

describe("PopupMapOptions counts", () => {
  it("lists a count for each map when given", () => {
    mockStore.maps = [["chernarusplus", "Chernarus"]];
    const html = renderToStaticMarkup(<PopupMapOptions counts={{ chernarusplus: 8412 }} />);
    expect(html).toContain('data-part="count"');
    expect(html).toContain("8,412");
  });

  it("names its list of maps", () => {
    mockStore.maps = [["chernarusplus", "Chernarus"]];
    const html = renderToStaticMarkup(<PopupMapOptions />);
    expect(html).toMatch(/role="listbox"[^>]*aria-label="Maps"/);
  });

  it("shows no count at all while the counts are still unknown", () => {
    mockStore.maps = [["chernarusplus", "Chernarus"]];
    const html = renderToStaticMarkup(<PopupMapOptions counts={undefined} />);
    expect(html).not.toContain('data-part="count"');
  });
});
