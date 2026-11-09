import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "./context";
import { NavLan, NavServers, NavMods, NavSettings } from "./nav-elements";

const render = (node: React.ReactElement, contextValue: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={contextValue}>{node}</ElementContextProvider>,
  );

// Captures a button's props as it is created, since renderToStaticMarkup
// discards event handlers from its HTML output.
const captured = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const el = (props as { "data-el"?: string })?.["data-el"];
      if (typeof el === "string") captured.set(el, props);
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

/** A storage that keeps its keys, so a write in one render is seen by the next. */
function fakeStorage(initial: Record<string, string> = {}) {
  const keys = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => keys.get(key) ?? null,
    setItem: (key: string, value: string) => void keys.set(key, value),
    removeItem: (key: string) => void keys.delete(key),
    clear: () => keys.clear(),
  };
}

afterEach(() => {
  captured.clear();
  vi.unstubAllGlobals();
});

describe("NavServers", () => {
  it("honours the icon option, and none removes it", () => {
    expect(render(<NavServers options={{ icon: "star" }} />)).toContain("lucide-star");
    expect(render(<NavServers options={{ icon: "none" }} />)).not.toContain("<svg");
  });

  it("display: icon hides the label but keeps the accessible name", () => {
    const html = render(<NavServers options={{ display: "icon" }} />);
    expect(html).not.toContain('data-part="label"');
    expect(html).toContain('aria-label="Servers"');
    expect(html).toContain('title="Servers"');
  });
});

describe("NavMods", () => {
  it("honours the icon option", () => {
    expect(render(<NavMods options={{ icon: "package" }} />)).toContain("lucide-package");
  });
});

describe("NavLan", () => {
  it("renders a button labelled LAN that opens the lan view", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "tetra.lan.seen": "1" }));
    const onViewChange = vi.fn();
    const html = render(<NavLan />, { onViewChange, activeView: "servers" });

    expect(html).toContain('aria-label="LAN"');
    expect(html).toContain("lucide-network");

    (captured.get("nav.lan")?.onClick as () => void)();
    expect(onViewChange).toHaveBeenCalledWith("lan");
  });

  it("is aria-current while the lan view is showing", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "tetra.lan.seen": "1" }));
    const html = render(<NavLan />, { activeView: "lan" });
    expect(html).toContain('aria-current="page"');
  });

  it("shows the New tag until the tab has been opened, then not again", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const first = render(<NavLan />, { onViewChange: vi.fn(), activeView: "servers" });
    expect(first).toContain('data-part="badge">New</span>');

    (captured.get("nav.lan")?.onClick as () => void)();
    const second = render(<NavLan />, { onViewChange: vi.fn(), activeView: "lan" });
    expect(second).not.toContain('data-part="badge"');
  });

  it("shows the New tag when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(render(<NavLan />, { activeView: "servers" })).toContain('data-part="badge">New</span>');
    expect(() => (captured.get("nav.lan")?.onClick as () => void)()).not.toThrow();
  });
});

describe("nav items", () => {
  const tagOf = (html: string, el: string) => html.match(new RegExp(`<button[^>]*data-el="${el}"[^>]*>`))?.[0] ?? "";

  it("mark the active view with aria-current and never use aria-selected or tabindex", () => {
    const html = render(
      <>
        <NavServers />
        <NavMods />
        <NavSettings />
      </>,
      { activeView: "servers" },
    );
    expect(tagOf(html, "nav.servers")).toContain('aria-current="page"');
    expect(tagOf(html, "nav.mods")).not.toContain("aria-current");
    expect(html).not.toContain("aria-selected");
    expect(html).not.toContain("tabindex");
  });
});
