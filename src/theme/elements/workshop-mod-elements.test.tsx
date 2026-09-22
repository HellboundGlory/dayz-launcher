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
  tauriMocks.openWorkshopInSteam.mockClear();
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
      {renderWorkshopModElement(el(element, options), {}) as React.ReactElement}
    </ElementContextProvider>,
  );
}

function renderPreview(element: string, previewMod: ModFilterEntry | null, options?: Record<string, unknown>) {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ previewMod }}>
      {renderWorkshopModElement(el(element, options), {}) as React.ReactElement}
    </ElementContextProvider>,
  );
}

describe("subject resolution", () => {
  it("reads the row subject from subjectContext", () => {
    const entry = makeEntry({ title: "Row Mod" });
    expect(renderEl("workshopMod.name", entry)).toContain("Row Mod");
  });

  it("falls back to previewMod outside a row context", () => {
    const entry = makeEntry({ title: "Preview Mod" });
    expect(renderPreview("workshopMod.name", entry)).toContain("Preview Mod");
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
  it("renders an image when a preview URL is present", () => {
    const entry = makeEntry({ previewUrl: "https://example.com/p.jpg" });
    const html = renderEl("workshopMod.thumbnail", entry);
    expect(html).toContain('data-part="image"');
    expect(html).not.toContain("missing");
  });

  it("falls back to an initials tile and the missing state without a preview URL", () => {
    const entry = makeEntry({ previewUrl: null, title: "Base Building Plus" });
    const html = renderEl("workshopMod.thumbnail", entry);
    expect(html).toContain('data-part="initials"');
    expect(html).toContain('data-state="missing"');
    expect(html).toContain("BB");
  });
});

describe("workshopMod.subscribed", () => {
  it("renders nothing unless subscribed", () => {
    expect(renderEl("workshopMod.subscribed", makeEntry({ subscribed: false }))).toBe("");
  });

  it("renders the star icon when subscribed", () => {
    expect(renderEl("workshopMod.subscribed", makeEntry({ subscribed: true }))).toContain('data-part="icon"');
  });
});

describe("workshopMod.serverCount", () => {
  it("shows the count and unit", () => {
    const html = renderEl("workshopMod.serverCount", makeEntry({ serverCount: 12 }));
    expect(html).toContain("12");
    expect(html).toContain("srv");
  });

  it("shows the none state and a dash without any servers", () => {
    const html = renderEl("workshopMod.serverCount", makeEntry({ serverCount: null }));
    expect(html).toContain('data-state="none"');
    expect(html).toContain("—");
  });
});

describe("workshopMod.score", () => {
  it("renders as a rounded percentage", () => {
    expect(renderEl("workshopMod.score", makeEntry({ score: 0.874 }))).toContain("87%");
  });

  it("renders nothing without a score", () => {
    expect(renderEl("workshopMod.score", makeEntry({ score: null }))).toBe("");
  });
});

describe("workshopMod.subscribers", () => {
  it("shows the count and default label", () => {
    const html = renderEl("workshopMod.subscribers", makeEntry({ numSubscriptions: "12000" }));
    expect(html).toContain("12,000");
    expect(html).toContain("subscribers");
  });

  it("honours the label option", () => {
    const html = renderEl("workshopMod.subscribers", makeEntry({ numSubscriptions: "5" }), { label: "subs" });
    expect(html).toContain("subs");
  });

  it("renders nothing without a subscriber count", () => {
    expect(renderEl("workshopMod.subscribers", makeEntry({ numSubscriptions: null }))).toBe("");
  });
});

describe("workshopMod.size", () => {
  it("formats the file size", () => {
    const html = renderEl("workshopMod.size", makeEntry({ fileSize: 1024 * 1024 }));
    expect(html).not.toContain('data-state="unknown"');
  });

  it("shows unknown without a size", () => {
    const html = renderEl("workshopMod.size", makeEntry({ fileSize: null }));
    expect(html).toContain('data-state="unknown"');
    expect(html).toContain("—");
  });
});

describe("workshopMod.updated", () => {
  it("renders nothing without a timestamp", () => {
    expect(renderEl("workshopMod.updated", makeEntry({ timeUpdated: null }))).toBe("");
  });

  it("reads the default label and a relative time", () => {
    const html = renderEl("workshopMod.updated", makeEntry({ timeUpdated: Math.floor(Date.now() / 1000) }));
    expect(html).toContain("Updated");
  });

  it("switches to a date with the format option", () => {
    const ts = Math.floor(new Date("2024-01-15").getTime() / 1000);
    const html = renderEl("workshopMod.updated", makeEntry({ timeUpdated: ts }), { format: "date" });
    expect(html).toContain(new Date(ts * 1000).toLocaleDateString());
  });
});

describe("workshopMod.description", () => {
  it("is empty when the mod has no description", () => {
    const html = renderEl("workshopMod.description", makeEntry({ description: null }));
    expect(html).toContain('data-state="empty"');
  });

  it("renders the description text and applies a clamp option", () => {
    const html = renderEl("workshopMod.description", makeEntry({ description: "Adds a trader" }), { clamp: 3 });
    expect(html).toContain("Adds a trader");
    expect(html).toContain("line-clamp");
  });
});

describe("workshopMod.tags", () => {
  it("renders nothing without tags", () => {
    expect(renderEl("workshopMod.tags", makeEntry({ tags: [] }))).toBe("");
  });

  it("renders every tag as a chip by default", () => {
    const html = renderEl("workshopMod.tags", makeEntry({ tags: ["a", "b", "c", "d"] }));
    expect(html.match(/data-part="chip"/g)?.length).toBe(4);
  });

  it("limits the tags shown with the limit option", () => {
    const html = renderEl("workshopMod.tags", makeEntry({ tags: ["a", "b", "c", "d"] }), { limit: 3 });
    expect(html.match(/data-part="chip"/g)?.length).toBe(3);
  });
});

describe("workshopMod.serverNote", () => {
  it("names the server count when seen", () => {
    const html = renderEl("workshopMod.serverNote", makeEntry({ serverCount: 4 }));
    expect(html).toContain("4 of the servers currently listed run this mod");
  });

  it("reads the not-seen note otherwise", () => {
    const html = renderEl("workshopMod.serverNote", makeEntry({ serverCount: null }));
    expect(html).toContain("Not seen on any currently listed server yet");
  });
});

describe("workshopMod.viewOnSteam", () => {
  it("reads View on Steam and opens the workshop page for the mod id", () => {
    const entry = makeEntry({ id: "99" });
    const html = renderEl("workshopMod.viewOnSteam", entry);
    expect(html).toContain("View on Steam");

    const stopPropagation = vi.fn();
    (captured["workshopMod.viewOnSteam"].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(tauriMocks.openWorkshopInSteam).toHaveBeenCalledWith("99");
  });
});

describe("workshopMod.include / workshopMod.exclude", () => {
  it("include reads Include/Included and sets the pick", () => {
    const entry = makeEntry({ id: "7" });
    let html = renderEl("workshopMod.include", entry);
    expect(html).toContain("Include");
    expect(captured["workshopMod.include"]["data-state"]).toBeUndefined();

    (captured["workshopMod.include"].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(useModFilterStore.getState().selection["7"]).toBe("include");

    html = renderEl("workshopMod.include", entry);
    expect(html).toContain("Included");
    expect(captured["workshopMod.include"]["data-state"]).toBe("on");
  });

  it("exclude reads Exclude/Excluded and sets the pick", () => {
    const entry = makeEntry({ id: "8" });
    let html = renderEl("workshopMod.exclude", entry);
    expect(html).toContain("Exclude");

    (captured["workshopMod.exclude"].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(useModFilterStore.getState().selection["8"]).toBe("exclude");

    html = renderEl("workshopMod.exclude", entry);
    expect(html).toContain("Excluded");
    expect(captured["workshopMod.exclude"]["data-state"]).toBe("on");
  });

  it("toggling the same pick again clears the selection", () => {
    const entry = makeEntry({ id: "9" });
    useModFilterStore.setState({ selection: { "9": "include" } }, false);
    renderEl("workshopMod.include", entry);
    (captured["workshopMod.include"].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(useModFilterStore.getState().selection["9"]).toBeUndefined();
  });
});
