import { describe, expect, it, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// SSR reads zustand's frozen initial-state snapshot, not live state, so route
// the hooks through live `getState()` reads (same pattern as server-elements.test.tsx).
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/server-store")>();
  return { ...actual, useServerStore: liveHook(actual.useServerStore) };
});

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

// Captures a rendered node's props by data-el, since renderToStaticMarkup drops
// event handlers from its HTML output (same pattern as filter-elements.test.tsx).
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const el = props?.["data-el"];
      if (typeof el === "string") captured[el] = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

import {
  TriggerPopup,
  PopupClear,
  PopupClose,
  PopupContextProvider,
  PopupMapOptions,
  PopupRegionNote,
  PopupRegionOptions,
  PopupSortOptions,
  PopupTagOptions,
  PopupUniqueServerOptions,
  UniqueServerOptionsList,
  mapMatchesQuery,
  nextSortDir,
  sortValueLabel,
} from "./popup-elements";

/** `overrides.filter` is merged onto the current filter, like the real `setFilter` does. */
async function withServerStore<T>(overrides: Record<string, unknown>, fn: () => T): Promise<T> {
  const { useServerStore } = await import("@/stores/server-store");
  const prior = useServerStore.getState();
  const filterOverride = overrides.filter as Record<string, unknown> | undefined;
  const next = { ...prior, ...overrides };
  if (filterOverride) next.filter = { ...prior.filter, ...filterOverride };
  useServerStore.setState(next as never);
  try {
    return fn();
  } finally {
    useServerStore.setState(prior, true);
  }
}

async function withModsStore<T>(overrides: Record<string, unknown>, fn: () => T): Promise<T> {
  const { useModsStore } = await import("@/stores/mods-store");
  const prior = useModsStore.getState();
  useModsStore.setState({ ...prior, ...overrides } as never);
  try {
    return fn();
  } finally {
    useModsStore.setState(prior, true);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nextSortDir", () => {
  it.each([
    { current: "players", dir: "desc", picked: "players", next: "asc" },
    { current: "players", dir: "asc", picked: "players", next: "desc" },
    { current: "players", dir: "asc", picked: "ping", next: "desc" },
  ] as const)(
    "moving from $current/$dir to $picked gives $next",
    ({ current, dir, picked, next }) => {
      expect(nextSortDir(current, dir, picked)).toBe(next);
    },
  );
});

describe("sortValueLabel", () => {
  it("maps store keys to display labels", () => {
    expect(sortValueLabel("mod_count")).toBe("Mods");
    expect(sortValueLabel("players")).toBe("Players");
  });
});

describe("PopupMapOptions", () => {
  it("renders the empty state while maps hasn't loaded", async () => {
    const html = await withServerStore({ maps: [], filter: { maps: [] } }, () =>
      renderToStaticMarkup(<PopupMapOptions />),
    );
    expect(html).toContain('data-el="popup.mapOptions"');
    expect(html).toContain('data-part="empty"');
    expect(html).toContain("Loading maps...");
  });

  it("marks the selected map with data-state and aria-selected", async () => {
    const html = await withServerStore(
      {
        maps: [
          ["chernarusplus", "Chernarus"],
          ["namalsk", "Namalsk"],
        ],
        filter: { maps: ["chernarusplus"] },
      },
      () => renderToStaticMarkup(<PopupMapOptions />),
    );
    expect(html).toContain('data-part="option" data-state="selected"');
    expect(html).toContain('role="option" aria-selected="true"');
    expect(html).toContain('role="option" aria-selected="false"');
  });

  it.each([
    {
      name: "official maps first, then a separator, then the rest",
      maps: [
        ["namalsk", "Namalsk"],
        ["enoch", "Livonia"],
        ["chernarusplus", "Chernarus"],
        ["banov", "Banov"],
      ],
      labels: ["Chernarus", "Livonia", "|", "Namalsk", "Banov"],
    },
    {
      name: "no separator when every map is official",
      maps: [["sakhal", "Sakhal"], ["chernarusplus", "Chernarus"]],
      labels: ["Chernarus", "Sakhal"],
    },
    {
      name: "no separator when no map is official",
      maps: [["namalsk", "Namalsk"]],
      labels: ["Namalsk"],
    },
  ])("orders the listbox: $name", async ({ maps, labels }) => {
    const html = await withServerStore({ maps, filter: { maps: [] } }, () =>
      renderToStaticMarkup(<PopupMapOptions />),
    );
    const sequence = [...html.matchAll(/data-part="separator"|<span class="truncate">([^<]+)<\/span>/g)].map(
      (m) => m[1] ?? "|",
    );
    expect(sequence).toEqual(labels);
  });
});

describe("mapMatchesQuery", () => {
  it.each([
    { query: "  CHER ", id: "chernarusplus", name: "Chernarus", match: true },
    { query: "gloom", id: "enochgloom", name: "Livonia (Gloom)", match: true },
    { query: "enoch", id: "chernarusplus", name: "Chernarus", match: false },
  ])("matches $query against $name by name or id: $match", ({ query, id, name, match }) => {
    expect(mapMatchesQuery(query, [id, name])).toBe(match);
  });
});

describe("PopupTagOptions", () => {
  it("marks included and excluded tags in the check column", async () => {
    const html = await withServerStore(
      { filter: { official: true, modded: false } },
      () => renderToStaticMarkup(<PopupTagOptions />),
    );
    expect(html).toContain('data-state="selected included"');
    expect(html).toContain('data-state="excluded"');
    expect(html.match(/data-part="box"[^>]*><span data-part="indicator"/g)).toHaveLength(3);
  });
});

describe("PopupRegionOptions", () => {
  it("marks selected regions", async () => {
    const html = await withServerStore(
      { filter: { countries: ["EU"] } },
      () => renderToStaticMarkup(<PopupRegionOptions />),
    );
    expect(html).toContain('data-state="selected"');
  });
});

describe("PopupRegionNote", () => {
  it("reads the approximate-location wording", () => {
    const html = renderToStaticMarkup(<PopupRegionNote />);
    expect(html).toContain('data-el="popup.regionNote"');
    expect(html).toContain("Approximate");
  });
});

describe("PopupSortOptions", () => {
  it("marks the active key with its direction", async () => {
    const html = await withServerStore({ sortKey: "ping", sortDir: "asc" }, () =>
      renderToStaticMarkup(<PopupSortOptions />),
    );
    expect(html).toContain('data-state="selected ascending"');
    expect(html).toContain('aria-selected="true"');
  });

  it("does not offer lastPlayed as a sort key", async () => {
    const html = await withServerStore({}, () => renderToStaticMarkup(<PopupSortOptions />));
    expect(html).not.toContain(">Last played<");
  });
});

describe("UniqueServerOptionsList", () => {
  it("renders the empty state with no cared servers", () => {
    const html = renderToStaticMarkup(<UniqueServerOptionsList caredServers={[]} onSelect={() => {}} />);
    expect(html).toContain("No favourites or recently played servers yet.");
  });

  it("renders one option per cared server", () => {
    const html = renderToStaticMarkup(
      <UniqueServerOptionsList
        caredServers={[{ addr: "1.2.3.4", query_port: 2303, name: "My Server" }]}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('data-part="option"');
    expect(html).toContain("My Server");
  });
});

describe("PopupUniqueServerOptions", () => {
  it("reads caredServers from the mods store", async () => {
    const html = await withModsStore(
      { caredServers: [{ addr: "1.2.3.4", query_port: 2303, name: "My Server" }] },
      () =>
        renderToStaticMarkup(
          <PopupContextProvider popupId="modsUnique" close={() => {}}>
            <PopupUniqueServerOptions />
          </PopupContextProvider>,
        ),
    );
    expect(html).toContain('data-el="popup.uniqueServerOptions"');
    expect(html).toContain("My Server");
  });
});

describe("PopupClear", () => {
  it("is disabled when the owning filter is empty", async () => {
    const html = await withServerStore({ filter: { maps: [] } }, () =>
      renderToStaticMarkup(
        <PopupContextProvider popupId="mapFilter" close={() => {}}>
          <PopupClear />
        </PopupContextProvider>,
      ),
    );
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain('disabled=""');
  });

  it("is enabled and clears only its own popup's filter", async () => {
    const setFilter = vi.fn();
    await withServerStore({ filter: { countries: ["EU"] }, setFilter }, () => {
      const html = renderToStaticMarkup(
        <PopupContextProvider popupId="regionFilter" close={() => {}}>
          <PopupClear />
        </PopupContextProvider>,
      );
      expect(html).not.toContain('data-state="disabled"');
      (captured["popup.clear"]?.onClick as () => void)?.();
      expect(setFilter).toHaveBeenCalledWith({ countries: [] });
    });
  });
});

describe("TriggerPopup", () => {
  const ref = { current: null };

  it("renders nothing while closed, themed or not", () => {
    const html = renderToStaticMarkup(
      <TriggerPopup open={false} popupId="mapFilter" close={() => {}} themedPopup={undefined} triggerRef={ref}>
        <div>default</div>
      </TriggerPopup>,
    );
    expect(html).toBe("");
  });

  it("renders the default children when the theme doesn't own the popup file", () => {
    const html = renderToStaticMarkup(
      <TriggerPopup open={true} popupId="mapFilter" close={() => {}} themedPopup={undefined} triggerRef={ref}>
        <div data-testid="default-body">default</div>
      </TriggerPopup>,
    );
    expect(html).toContain("default-body");
    expect(html).not.toContain("data-popup-host");
  });

  it("renders the theme's PopupHost instead of the default children when it owns the popup file", () => {
    const html = renderToStaticMarkup(
      <TriggerPopup
        open={true}
        popupId="mapFilter"
        close={() => {}}
        themedPopup={{ schemaVersion: 2, root: { type: "text", value: "Themed" } }}
        triggerRef={ref}
      >
        <div data-testid="default-body">default</div>
      </TriggerPopup>,
    );
    expect(html).toContain("data-popup-host");
    expect(html).toContain("Themed");
    expect(html).not.toContain("default-body");
  });
});

describe("PopupClose", () => {
  it("calls the popup context's close on click", () => {
    const close = vi.fn();
    renderToStaticMarkup(
      <PopupContextProvider popupId="mapFilter" close={close}>
        <PopupClose />
      </PopupContextProvider>,
    );
    (captured["popup.close"]?.onClick as () => void)?.();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
