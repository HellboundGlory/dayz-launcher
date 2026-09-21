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
  setFilter: vi.fn((patch: Partial<ServerFilter>) => Object.assign(mockStore.filter, patch)),
  resetFilter: vi.fn(),
};

vi.mock("@/stores/server-store", () => ({
  useServerStore: (selector: (s: typeof mockStore) => unknown) => selector(mockStore),
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
  FilterMaxPing,
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
} from "./filter-elements";

beforeEach(() => {
  mockStore.filter = makeFilter();
  mockStore.maps = [];
  mockStore.setFilter.mockClear();
  mockStore.resetFilter.mockClear();
  capturedProps = null;
  captureDataEl = null;
});

describe("mapDisplayValue", () => {
  it("reads Any with no maps selected", () => {
    expect(mapDisplayValue([], [])).toBe("Any");
  });

  it("reads the map's display name with one selected", () => {
    expect(mapDisplayValue(["chernarusplus"], [["chernarusplus", "Chernarus"]])).toBe("Chernarus");
  });

  it("reads a count with several selected", () => {
    expect(mapDisplayValue(["a", "b", "c"], [])).toBe("3 maps");
  });
});

describe("tagsDisplayValue and cycleTagValue", () => {
  it("cycles null -> true -> false -> null", () => {
    expect(cycleTagValue(null)).toBe(true);
    expect(cycleTagValue(true)).toBe(false);
    expect(cycleTagValue(false)).toBeNull();
  });

  it("reads Any with nothing active", () => {
    expect(tagsDisplayValue(0)).toBe("Any");
  });

  it("reads a plural count for multiple active tags", () => {
    expect(tagsDisplayValue(2)).toBe("2 tags");
  });

  it("reads a singular count for one active tag", () => {
    expect(tagsDisplayValue(1)).toBe("1 tag");
  });
});

describe("regionDisplayValue and toggleInList", () => {
  it("uses EU/NA/AS/OC/SA region codes, not country codes", () => {
    expect(REGIONS.map((r) => r.code)).toEqual(["EU", "NA", "AS", "OC", "SA"]);
  });

  it("reads Any with no regions selected", () => {
    expect(regionDisplayValue([])).toBe("Any");
  });

  it("reads the region name with one selected", () => {
    expect(regionDisplayValue(["EU"])).toBe("Europe");
  });

  it("reads a count with several selected", () => {
    expect(regionDisplayValue(["EU", "NA"])).toBe("2 regions");
  });

  it("toggles a code into and out of the list", () => {
    expect(toggleInList([], "EU")).toEqual(["EU"]);
    expect(toggleInList(["EU"], "EU")).toEqual([]);
    expect(toggleInList(["EU"], "NA")).toEqual(["EU", "NA"]);
  });
});

describe("ping helpers", () => {
  it("maps a null filter to the top of the slider and 'Any'", () => {
    expect(pingSliderValue(null)).toBe(500);
    expect(pingDisplayValue(null)).toBe("Any");
  });

  it("maps the top of the slider back to a null filter", () => {
    expect(nextPingFilter(500)).toBeNull();
  });

  it("reads '{v}ms' below the top of the range", () => {
    expect(pingSliderValue(250)).toBe(250);
    expect(pingDisplayValue(250)).toBe("250ms");
    expect(nextPingFilter(250)).toBe(250);
  });
});

describe("FilterSearch", () => {
  it("renders the icon and input parts with no filled state when empty", () => {
    const html = renderToStaticMarkup(<FilterSearch />);
    expect(html).toContain('data-el="filter.search"');
    expect(html).not.toContain('data-state="filled"');
    expect(html).toContain('data-part="icon"');
    expect(html).toContain('data-part="input"');
    expect(html).toContain("Search name or description");
  });

  it("renders the filled state when the store has a search term", () => {
    mockStore.filter.search = "chernarus";
    const html = renderToStaticMarkup(<FilterSearch />);
    expect(html).toContain('data-state="filled"');
  });

  it("omits the icon part when showIcon is false", () => {
    const html = renderToStaticMarkup(<FilterSearch options={{ showIcon: false }} />);
    expect(html).not.toContain('data-part="icon"');
  });
});

describe("FilterMap", () => {
  it("renders 'Any' and no active state with nothing selected", () => {
    const html = renderToStaticMarkup(<FilterMap />);
    expect(html).toContain('data-el="filter.map"');
    expect(html).not.toContain('data-state="active"');
    expect(html).toContain('data-part="value"');
    expect(html).toContain(">Any<");
  });

  it("renders the map name and active state with one selected", () => {
    mockStore.filter.maps = ["chernarusplus"];
    mockStore.maps = [["chernarusplus", "Chernarus"]];
    const html = renderToStaticMarkup(<FilterMap />);
    expect(html).toContain('data-state="active"');
    expect(html).toContain("Chernarus");
  });

  it("renders a count with several selected", () => {
    mockStore.filter.maps = ["a", "b", "c"];
    const html = renderToStaticMarkup(<FilterMap />);
    expect(html).toContain("3 maps");
  });
});

describe("FilterTags", () => {
  it("renders 'Any' with nothing active", () => {
    const html = renderToStaticMarkup(<FilterTags />);
    expect(html).toContain('data-el="filter.tags"');
    expect(html).toContain(">Any<");
  });

  it("renders the active count", () => {
    mockStore.filter.official = true;
    mockStore.filter.modded = false;
    const html = renderToStaticMarkup(<FilterTags />);
    expect(html).toContain("2 tags");
    expect(html).toContain('data-state="active"');
  });
});

describe("FilterRegion", () => {
  it("defaults the label to REGION", () => {
    const html = renderToStaticMarkup(<FilterRegion />);
    expect(html).toContain('data-el="filter.region"');
    expect(html).toContain(">REGION<");
    expect(html).toContain(">Any<");
  });

  it("honours a label option override", () => {
    const html = renderToStaticMarkup(<FilterRegion options={{ label: "Country" }} />);
    expect(html).toContain(">Country<");
  });

  it("renders a region count and active state", () => {
    mockStore.filter.countries = ["EU", "NA"];
    const html = renderToStaticMarkup(<FilterRegion />);
    expect(html).toContain("2 regions");
    expect(html).toContain('data-state="active"');
  });
});

describe("FilterMaxPing", () => {
  it("reads 'Any' with no ping limit and removes the bordered box", () => {
    const html = renderToStaticMarkup(<FilterMaxPing />);
    expect(html).toContain('data-el="filter.maxPing"');
    expect(html).not.toContain('data-state="active"');
    expect(html).toContain(">Any<");
    expect(html).not.toContain("border-border");
  });

  it("reads '{v}ms' and is active below the top of the range", () => {
    mockStore.filter.max_ping = 250;
    const html = renderToStaticMarkup(<FilterMaxPing />);
    expect(html).toContain('data-state="active"');
    expect(html).toContain("250ms");
  });
});

describe("hide toggles", () => {
  it("default their labels", () => {
    expect(renderToStaticMarkup(<FilterHideEmpty />)).toContain("Hide empty");
    expect(renderToStaticMarkup(<FilterHideFull />)).toContain("Hide full");
    expect(renderToStaticMarkup(<FilterHideLocked />)).toContain("Hide locked");
    expect(renderToStaticMarkup(<FilterHideOffline />)).toContain("Hide offline");
  });

  it("honours a label override", () => {
    const html = renderToStaticMarkup(<FilterHideEmpty options={{ label: "No empties" }} />);
    expect(html).toContain("No empties");
  });

  it("carries the on state and aria-pressed when active", () => {
    mockStore.filter.hide_empty = true;
    const html = renderToStaticMarkup(<FilterHideEmpty />);
    expect(html).toContain('data-state="on"');
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders role=checkbox with a box part when control is checkbox", () => {
    const html = renderToStaticMarkup(<FilterHideEmpty options={{ control: "checkbox" }} />);
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('data-part="box"');
  });

  it("renders role=switch when control is switch", () => {
    const html = renderToStaticMarkup(<FilterHideEmpty options={{ control: "switch" }} />);
    expect(html).toContain('role="switch"');
  });
});

describe("FilterReset", () => {
  it("defaults to the iconLabel display with the label Reset", () => {
    const html = renderToStaticMarkup(<FilterReset />);
    expect(html).toContain('data-el="filter.reset"');
    expect(html).toContain('data-part="icon"');
    expect(html).toContain(">Reset<");
  });

  it("honours display: icon by omitting the label part", () => {
    const html = renderToStaticMarkup(<FilterReset options={{ display: "icon" }} />);
    expect(html).not.toContain('data-part="label"');
  });

  it("honours a label override", () => {
    const html = renderToStaticMarkup(<FilterReset options={{ label: "Clear filters" }} />);
    expect(html).toContain("Clear filters");
  });
});

describe("ServersRefresh", () => {
  it("calls context onRefresh when clicked", () => {
    const onRefresh = vi.fn();
    captureDataEl = "servers.refresh";
    renderToStaticMarkup(
      <ElementContextProvider value={{ onRefresh, refreshing: false }}>
        <ServersRefresh />
      </ElementContextProvider>,
    );
    (capturedProps?.onClick as () => void)?.();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows busy state and is disabled while refreshing", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ onRefresh: vi.fn(), refreshing: true }}>
        <ServersRefresh />
      </ElementContextProvider>,
    );
    expect(html).toContain('data-state="busy"');
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Refreshing…");
  });

  it("reads Refresh while idle", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ onRefresh: vi.fn(), refreshing: false }}>
        <ServersRefresh />
      </ElementContextProvider>,
    );
    expect(html).not.toContain('data-state="busy"');
    expect(html).toContain(">Refresh<");
  });
});
