import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { renderModFilterElement } from "./mod-filter-elements";
import type { ElementNode } from "../renderer/types";

// SSR takes zustand's initial-state snapshot, so route the hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mod-filter-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mod-filter-store")>();
  return { ...actual, useModFilterStore: liveHook(actual.useModFilterStore) };
});

vi.mock("@/stores/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/server-store")>();
  return { ...actual, useServerStore: liveHook(actual.useServerStore) };
});

const { useModFilterStore } = await import("@/stores/mod-filter-store");
const { useServerStore } = await import("@/stores/server-store");

// Captures the props of interactive elements as they are created, keyed by
// `data-el` or `id`, since renderToStaticMarkup discards event handlers from its HTML output.
let captured: Record<string, Record<string, unknown>> = {};

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if ((type === "button" || type === "input" || type === "div") && props) {
        const key = (props["data-el"] as string | undefined) ?? (props.id as string | undefined);
        if (key) captured[key] = props;
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const INITIAL_STATE = {
  tab: "subscribed" as const,
  query: "",
  selection: {} as Record<string, "include" | "exclude">,
  mode: "any" as const,
  previewId: null as string | null,
  meta: {} as Record<string, { title: string; previewUrl: string | null }>,
  known: null,
  knownLoading: false,
  searchResults: [],
  searchLoading: false,
  searchError: null,
  usage: {} as Record<string, number>,
};

beforeEach(() => {
  captured = {};
  useModFilterStore.setState(INITIAL_STATE, false);
  useServerStore.setState(
    { filter: { ...useServerStore.getState().filter, mod_ids: [], mod_ids_exclude: [], mod_match: "any" } },
    false,
  );
});

function el(element: string, options?: Record<string, unknown>): ElementNode {
  return { element, options } as ElementNode;
}

function renderEl(element: string, options?: Record<string, unknown>, ctx?: Record<string, unknown>) {
  return renderToStaticMarkup(
    <ElementContextProvider value={ctx}>
      {renderModFilterElement(el(element, options), {}) as React.ReactElement}
    </ElementContextProvider>,
  );
}

describe("modFilter.apply", () => {
  it("writes the selection and match mode to the server filter, then closes", () => {
    const closeModal = vi.fn();
    useModFilterStore.setState({ selection: { "123": "include", "456": "exclude" }, mode: "all" }, false);
    renderEl("modFilter.apply", undefined, { closeModal });

    (captured["modFilter.apply"].onClick as () => void)();

    const filter = useServerStore.getState().filter;
    expect(filter.mod_ids).toEqual(["123"]);
    expect(filter.mod_ids_exclude).toEqual(["456"]);
    expect(filter.mod_match).toBe("all");
    expect(closeModal).toHaveBeenCalledTimes(1);
  });
});

describe("modFilter.cancel", () => {
  it("closes without applying, and reads Cancel by default", () => {
    const closeModal = vi.fn();
    useModFilterStore.setState({ selection: { "1": "include" } }, false);
    const html = renderEl("modFilter.cancel", undefined, { closeModal });
    expect(html).toContain("Cancel");

    (captured["modFilter.cancel"].onClick as () => void)();

    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(useServerStore.getState().filter.mod_ids).toEqual([]);
  });

  it("honours the label option", () => {
    const html = renderEl("modFilter.cancel", { label: "Nevermind" });
    expect(html).toContain("Nevermind");
  });
});

describe("modFilter.clear", () => {
  it("is disabled with nothing selected", () => {
    const html = renderEl("modFilter.clear");
    expect(captured["modFilter.clear"]["data-state"]).toBe("disabled");
    expect(html).toContain("disabled");
  });

  it("is enabled and clears the selection on click otherwise", () => {
    useModFilterStore.setState({ selection: { "1": "include" } }, false);
    renderEl("modFilter.clear");
    expect(captured["modFilter.clear"]["data-state"]).toBeUndefined();

    (captured["modFilter.clear"].onClick as () => void)();

    expect(useModFilterStore.getState().selection).toEqual({});
  });

  it("honours the label option", () => {
    const html = renderEl("modFilter.clear", { label: "Reset" });
    expect(html).toContain("Reset");
  });
});

describe("modFilter.source", () => {
  it("marks the active tab selected", () => {
    useModFilterStore.setState({ tab: "seen" }, false);
    renderEl("modFilter.source");
    expect(captured["modFilter-source-seen"]["aria-selected"]).toBe(true);
    expect(captured["modFilter-source-subscribed"]["aria-selected"]).toBe(false);
  });

  it("switches tabs on click and clears the preview", () => {
    useModFilterStore.setState({ previewId: "42" }, false);
    renderEl("modFilter.source");

    (captured["modFilter-source-workshop"].onClick as () => void)();

    expect(useModFilterStore.getState().tab).toBe("workshop");
    expect(useModFilterStore.getState().previewId).toBeNull();
  });
});

describe("modFilter.search", () => {
  it("uses the placeholder for the active tab", () => {
    useModFilterStore.setState({ tab: "workshop" }, false);
    expect(renderEl("modFilter.search")).toContain("Search the Workshop by name");

    useModFilterStore.setState({ tab: "subscribed" }, false);
    expect(renderEl("modFilter.search")).toContain("Filter your subscribed mods");

    useModFilterStore.setState({ tab: "seen" }, false);
    expect(renderEl("modFilter.search")).toContain("Filter mods seen on these servers");
  });

  it("is filled once there's a query and busy while the workshop search loads", () => {
    useModFilterStore.setState({ tab: "workshop", query: "trader", searchLoading: true }, false);
    renderEl("modFilter.search");
    const state = (captured["modFilter.search"]["data-state"] as string) ?? "";
    expect(state).toContain("filled");
    expect(state).toContain("busy");
  });

  it("is not busy outside the workshop tab even while searchLoading is stale", () => {
    useModFilterStore.setState({ tab: "subscribed", searchLoading: true }, false);
    renderEl("modFilter.search");
    const state = (captured["modFilter.search"]["data-state"] as string) ?? "";
    expect(state).not.toContain("busy");
  });

  it("hides the icon by default and shows it when showIcon is set", () => {
    expect(renderEl("modFilter.search")).not.toContain('data-part="icon"');
    expect(renderEl("modFilter.search", { showIcon: true })).toContain('data-part="icon"');
  });
});

describe("modFilter.summary", () => {
  it("reads Nothing selected when empty", () => {
    const html = renderEl("modFilter.summary");
    expect(html).toContain("Nothing selected");
    expect(captured["modFilter.summary"]["data-state"]).toBe("empty");
  });

  it("shows counts and caps thumbnails at 4 with a +n more", () => {
    const selection: Record<string, "include" | "exclude"> = {};
    for (let i = 0; i < 5; i++) selection[`m${i}`] = i < 3 ? "include" : "exclude";
    useModFilterStore.setState({ selection }, false);
    const html = renderEl("modFilter.summary");
    expect(html).toContain("3 included");
    expect(html).toContain("2 excluded");
    expect(html).toContain("+1");
  });

  it("omits thumbnails when showThumbnails is false", () => {
    useModFilterStore.setState({ selection: { m1: "include" } }, false);
    const html = renderEl("modFilter.summary", { showThumbnails: false });
    expect(html).not.toContain('data-part="thumbnails"');
    expect(html).toContain('data-part="counts"');
  });
});

describe("modFilter.matchMode", () => {
  it("marks the active mode selected and switches on click", () => {
    useModFilterStore.setState({ mode: "all" }, false);
    renderEl("modFilter.matchMode");
    expect(captured["modFilter-matchMode-all"]["aria-checked"]).toBe(true);
    expect(captured["modFilter-matchMode-any"]["aria-checked"]).toBe(false);

    (captured["modFilter-matchMode-any"].onClick as () => void)();
    expect(useModFilterStore.getState().mode).toBe("any");
  });
});
