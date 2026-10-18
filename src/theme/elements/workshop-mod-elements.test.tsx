import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { renderWorkshopModElement } from "./workshop-mod-elements";
import type { ElementNode } from "../renderer/types";
import type { ModFilterEntry } from "@/stores/mod-filter-store";

// SSR takes zustand's initial-state snapshot, so route the hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mod-filter-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mod-filter-store")>();
  return { ...actual, useModFilterStore: liveHook(actual.useModFilterStore) };
});

const tauriMocks = vi.hoisted(() => ({
  openWorkshopInSteam: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, ...tauriMocks };
});

const { useModFilterStore } = await import("@/stores/mod-filter-store");

// Captures the props of interactive elements as they are created, keyed by
// `data-el`, since renderToStaticMarkup discards event handlers from its HTML output.
let captured: Record<string, Record<string, unknown>> = {};

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if ((type === "button" || type === "span") && props) {
        const key = props["data-el"] as string | undefined;
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
});

function makeEntry(overrides: Partial<ModFilterEntry> = {}): ModFilterEntry {
  return {
    id: "42",
    title: "Trader Mod",
    previewUrl: null,
    subscribed: false,
    serverCount: null,
    description: null,
    tags: [],
    numSubscriptions: null,
    score: null,
    fileSize: null,
    timeUpdated: null,
    workshopUrl: null,
    ...overrides,
  };
}

function el(element: string, options?: Record<string, unknown>): ElementNode {
  return { element, options } as ElementNode;
}

function renderEl(element: string, entry: ModFilterEntry | null, options?: Record<string, unknown>) {
  return renderToStaticMarkup(
    <ElementContextProvider value={entry ? { subjectContext: { kind: "workshopMod", data: entry } } : {}}>
      {renderWorkshopModElement(el(element, options), {})}
    </ElementContextProvider>,
  );
}

function renderPreview(element: string, previewMod: ModFilterEntry | null, options?: Record<string, unknown>) {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ previewMod }}>
      {renderWorkshopModElement(el(element, options), {})}
    </ElementContextProvider>,
  );
}

describe("subject resolution", () => {
  it("reads the row subject from subjectContext, falling back to previewMod", () => {
    expect(renderEl("workshopMod.name", makeEntry({ title: "Row Mod" }))).toContain("Row Mod");
    expect(renderPreview("workshopMod.name", makeEntry({ title: "Preview Mod" }))).toContain("Preview Mod");
  });

  it("renders nothing with no subject at all", () => {
    expect(renderEl("workshopMod.name", null)).toBe("");
  });
});

describe("workshopMod.pick", () => {
  it("cycles none -> include -> exclude -> none with matching accessible names", () => {
    const entry = makeEntry({ id: "1", title: "Trader" });

    let html = renderEl("workshopMod.pick", entry);
    expect(html).not.toContain("included");
    expect(captured["workshopMod.pick"]["aria-label"]).toBe("Include Trader");

    useModFilterStore.setState({ selection: { "1": "include" } }, false);
    html = renderEl("workshopMod.pick", entry);
    expect(captured["workshopMod.pick"]["data-state"]).toBe("included");
    expect(captured["workshopMod.pick"]["aria-label"]).toBe("Exclude Trader instead");

    useModFilterStore.setState({ selection: { "1": "exclude" } }, false);
    renderEl("workshopMod.pick", entry);
    expect(captured["workshopMod.pick"]["data-state"]).toBe("excluded");
    expect(captured["workshopMod.pick"]["aria-label"]).toBe("Clear the Trader filter");
  });

  it("stops propagation and calls cycle on click", () => {
    const entry = makeEntry({ id: "5", title: "Base Building+" });
    renderEl("workshopMod.pick", entry);
    const stopPropagation = vi.fn();
    (captured["workshopMod.pick"].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(useModFilterStore.getState().selection["5"]).toBe("include");
  });
});

describe("workshopMod.thumbnail", () => {
  it("renders an image, or an initials tile and the missing state without a preview URL", () => {
    const withUrl = renderEl("workshopMod.thumbnail", makeEntry({ previewUrl: "https://example.com/p.jpg" }));
    expect(withUrl).toContain('data-part="image"');
    expect(withUrl).not.toContain("missing");

    const withoutUrl = renderEl("workshopMod.thumbnail", makeEntry({ previewUrl: null, title: "Base Building Plus" }));
    expect(withoutUrl).toContain('data-part="initials"');
    expect(withoutUrl).toContain('data-state="missing"');
    expect(withoutUrl).toContain("BB");
  });
});

describe("workshopMod.subscribed", () => {
  it("renders nothing unless subscribed, else the star icon", () => {
    expect(renderEl("workshopMod.subscribed", makeEntry({ subscribed: false }))).toBe("");
    expect(renderEl("workshopMod.subscribed", makeEntry({ subscribed: true }))).toContain('data-part="icon"');
  });
});

describe("workshopMod.serverCount", () => {
  it("shows the count and unit, or the none state and a dash without any servers", () => {
    const counted = renderEl("workshopMod.serverCount", makeEntry({ serverCount: 12 }));
    expect(counted).toContain("12");
    expect(counted).toContain("srv");

    const none = renderEl("workshopMod.serverCount", makeEntry({ serverCount: null }));
    expect(none).toContain('data-state="none"');
    expect(none).toContain("—");
  });
});

describe("workshopMod.score", () => {
  it("renders as a rounded percentage, and nothing without a score", () => {
    expect(renderEl("workshopMod.score", makeEntry({ score: 0.874 }))).toContain("87%");
    expect(renderEl("workshopMod.score", makeEntry({ score: null }))).toBe("");
  });
});

describe("workshopMod.subscribers", () => {
  it("shows the count with the default or given label, and nothing without a count", () => {
    const html = renderEl("workshopMod.subscribers", makeEntry({ numSubscriptions: "12000" }));
    expect(html).toContain("12,000");
    expect(html).toContain("subscribers");

    expect(renderEl("workshopMod.subscribers", makeEntry({ numSubscriptions: "5" }), { label: "subs" })).toContain(
      "subs",
    );
    expect(renderEl("workshopMod.subscribers", makeEntry({ numSubscriptions: null }))).toBe("");
  });
});

describe("workshopMod.size", () => {
  it("formats the file size, or shows the unknown state without one", () => {
    expect(renderEl("workshopMod.size", makeEntry({ fileSize: 1024 * 1024 }))).not.toContain('data-state="unknown"');

    const missing = renderEl("workshopMod.size", makeEntry({ fileSize: null }));
    expect(missing).toContain('data-state="unknown"');
    expect(missing).toContain("—");
  });
});

describe("workshopMod.updated", () => {
  it("reads the default label with a relative time, a date with the format option, and nothing without a timestamp", () => {
    expect(renderEl("workshopMod.updated", makeEntry({ timeUpdated: null }))).toBe("");

    const relative = renderEl("workshopMod.updated", makeEntry({ timeUpdated: Math.floor(Date.now() / 1000) }));
    expect(relative).toContain("Updated");

    const ts = Math.floor(new Date("2024-01-15").getTime() / 1000);
    expect(renderEl("workshopMod.updated", makeEntry({ timeUpdated: ts }), { format: "date" })).toContain(
      new Date(ts * 1000).toLocaleDateString(),
    );
  });
});

describe("workshopMod.description", () => {
  it("marks the empty state, and renders the text under the clamp option", () => {
    expect(renderEl("workshopMod.description", makeEntry({ description: null }))).toContain('data-state="empty"');

    const html = renderEl("workshopMod.description", makeEntry({ description: "Adds a trader" }), { clamp: 3 });
    expect(html).toContain("Adds a trader");
    expect(html).toContain("line-clamp");
  });
});

describe("workshopMod.tags", () => {
  it("renders nothing without tags, else every tag as a chip capped by the limit option", () => {
    expect(renderEl("workshopMod.tags", makeEntry({ tags: [] }))).toBe("");

    const all = renderEl("workshopMod.tags", makeEntry({ tags: ["a", "b", "c", "d"] }));
    expect(all.match(/data-part="chip"/g)?.length).toBe(4);

    const limited = renderEl("workshopMod.tags", makeEntry({ tags: ["a", "b", "c", "d"] }), { limit: 3 });
    expect(limited.match(/data-part="chip"/g)?.length).toBe(3);
  });
});

describe("workshopMod.serverNote", () => {
  it("names the server count when seen, and reads the not-seen note otherwise", () => {
    const seen = renderEl("workshopMod.serverNote", makeEntry({ serverCount: 4 }));
    expect(seen).toContain('<span data-part="count">4</span>');
    expect(seen).toContain("of the servers currently listed run this mod");
    expect(renderEl("workshopMod.serverNote", makeEntry({ serverCount: null }))).toContain(
      "Not seen on any currently listed server yet",
    );
  });
});

describe("workshopMod.viewOnSteam", () => {
  it("reads View on Steam and opens the workshop page for the mod id, and nothing without a Workshop URL", () => {
    const entry = makeEntry({ id: "99", workshopUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=99" });
    expect(renderEl("workshopMod.viewOnSteam", entry)).toContain("View on Steam");

    const stopPropagation = vi.fn();
    (captured["workshopMod.viewOnSteam"].onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation,
    });
    expect(stopPropagation).toHaveBeenCalled();
    expect(tauriMocks.openWorkshopInSteam).toHaveBeenCalledWith("99");

    expect(renderEl("workshopMod.viewOnSteam", makeEntry({ workshopUrl: null }))).toBe("");
  });
});

describe("workshopMod.include / workshopMod.exclude", () => {
  it.each([
    { element: "workshopMod.include", pick: "include", idle: "Include", active: "Included" },
    { element: "workshopMod.exclude", pick: "exclude", idle: "Exclude", active: "Excluded" },
  ] as const)("$element reads $idle, then $active once clicked", (c) => {
    const entry = makeEntry({ id: "7" });

    expect(renderEl(c.element, entry)).toContain(`>${c.idle}<`);
    expect(captured[c.element]["data-state"]).toBeUndefined();

    (captured[c.element].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(useModFilterStore.getState().selection["7"]).toBe(c.pick);

    expect(renderEl(c.element, entry)).toContain(`>${c.active}<`);
    expect(captured[c.element]["data-state"]).toBe("on");
  });
});
