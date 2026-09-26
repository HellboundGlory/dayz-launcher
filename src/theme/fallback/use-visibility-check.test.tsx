import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useServerStore } from "@/stores/server-store";
import type { ThemeFile } from "@/types/theme";
import type * as VisibilityModule from "./visibility";
import type { LayoutFile } from "../renderer/types";
import { SETTINGS_LAYOUT, SERVER_INFO_MODAL } from "../neutral";
import { SettingsHost } from "../interaction/settings-host";
import { ModalHost } from "../interaction/modal-host";
import { useThemeStore } from "../theme-store";
import { useFallbackStore, clearFallbacks } from "./store";
import {
  applyVisibilityCheck,
  attributeElement,
  resolveActiveContexts,
  resolveRequiredElements,
  startVisibilityChecks,
  RESIZE_DEBOUNCE_MS,
  VISIBILITY_CHECK_MEASURE,
  type ActiveContexts,
  type VisibilityCheckEnv,
} from "./use-visibility-check";

// The pass needs no real renderer: the DOM shape it reads is asserted here and
// the visibility rules themselves are covered by fallback.test.tsx.
const visibility = vi.hoisted(() => ({ runVisibilityCheck: vi.fn() }));
vi.mock("./visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof VisibilityModule>();
  return { ...actual, runVisibilityCheck: visibility.runVisibilityCheck };
});

/** The attribute-selector subset the resolver uses, over a tiny element tree. */
class El {
  parent: El | null = null;
  children: El[] = [];

  constructor(public attrs: Record<string, string> = {}) {}

  add(child: El): El {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }

  matches(selector: string): boolean {
    const matchesSimple = (el: El, simple: string): boolean => {
      const parts = simple.match(/\[[^\]]+\]/g) ?? [];
      if (parts.length === 0) return false;
      return parts.every((part) => {
        const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
        if (!m) return false;
        return m[2] === undefined ? el.hasAttribute(m[1]) : el.getAttribute(m[1]) === m[2];
      });
    };
    return selector.split(",").some((alternative) => {
      const chain = alternative.trim().split(/\s+/).filter(Boolean);
      if (chain.length === 0) return false;
      if (!matchesSimple(this, chain[chain.length - 1])) return false;
      let node = this.parent;
      for (let i = chain.length - 2; i >= 0; i -= 1) {
        while (node && !matchesSimple(node, chain[i])) node = node.parent;
        if (!node) return false;
        node = node.parent;
      }
      return true;
    });
  }

  querySelectorAll(selector: string): El[] {
    const found: El[] = [];
    const walk = (node: El) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector: string): El | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const layoutWith = (...elements: string[]): LayoutFile =>
  ({ schemaVersion: 2, root: { children: elements.map((element) => ({ element })) } }) as unknown as LayoutFile;

const popupWith = (element: string, mode: "anchored" | "region" | "inline"): LayoutFile =>
  ({ ...layoutWith(element), placement: { mode } }) as unknown as LayoutFile;

beforeEach(() => {
  clearFallbacks();
});

afterEach(() => {
  clearFallbacks();
  useThemeStore.setState({ activeId: "neutral", themeFiles: {} });
});

function installTheme(id: string, layouts: Record<string, LayoutFile>): void {
  useThemeStore.setState({
    activeId: id,
    themeFiles: { [id]: { layouts } as unknown as ThemeFile },
  });
}

const SHELL = "layout/shell.json";
const BROWSER = "layout/views/browser.json";
const SERVER_LIST = "layout/lists/servers.json";
const MAP_POPUP = "layout/popups/mapFilter.json";

const shellOnly = { [SHELL]: layoutWith("nav.servers", "app.close") };

const baseEnv: VisibilityCheckEnv = { activeView: "servers", settingsOpen: false };

/** The resolver only ever calls `querySelector`, so the mock tree stands in for a live root. */
const asRoot = (el: El): HTMLElement => el as unknown as HTMLElement;

const browserTree = (): El => {
  const root = new El();
  const list = root.add(new El({ "data-el": "list.servers" }));
  list.add(new El({ role: "row", "aria-selected": "true" }));
  return root;
};

describe("resolveActiveContexts", () => {
  it("activates the browser view and its rendered list row context", () => {
    const { contexts } = resolveActiveContexts(baseEnv, asRoot(browserTree()));
    expect(contexts).toContain("views");
    expect(contexts).toContain("views+settings");
    expect(contexts).toContain("view:browser");
    expect(contexts).toContain("list:servers/row");
    expect(contexts).toContain("withJoin");
    expect(contexts).not.toContain("view:mods");
  });

  it("leaves a list's row context off while the list renders no rows", () => {
    const root = new El();
    root.add(new El({ "data-el": "list.servers" }));
    expect(resolveActiveContexts(baseEnv, asRoot(root)).contexts).not.toContain("list:servers/row");
  });

  it("switches the view context to mods", () => {
    const { contexts } = resolveActiveContexts({ ...baseEnv, activeView: "mods" }, asRoot(new El()));
    expect(contexts).toContain("view:mods");
    expect(contexts).not.toContain("view:browser");
  });

  it("adds settings contexts, dropping the view context in `view` presentation", () => {
    const overlay = resolveActiveContexts({ ...baseEnv, settingsOpen: true }, asRoot(browserTree()));
    expect(overlay.contexts).toContain("settings");
    expect(overlay.contexts).toContain("view:browser");

    const view = resolveActiveContexts(
      { ...baseEnv, settingsOpen: true, settingsPresentation: "view" },
      asRoot(browserTree()),
    );
    expect(view.contexts).toContain("settings");
    expect(view.contexts).not.toContain("view:browser");
    expect(view.contexts).not.toContain("list:servers/row");
  });

  it("adds the generic and specific modal contexts while a themed modal is mounted", () => {
    const root = new El();
    root.add(new El({ "data-modal-host": "" }));
    const { contexts, openModals } = resolveActiveContexts(
      { ...baseEnv, openModals: ["update"] },
      asRoot(root),
    );
    expect(openModals).toEqual(["update"]);
    expect(contexts).toContain("modal");
    expect(contexts).toContain("modal:update");
  });

  it("reads an open popup from its trigger and its theme-owned placement mode", () => {
    installTheme("local.test", { ...shellOnly, [MAP_POPUP]: popupWith("popup.mapOptions", "region") });
    const root = new El();
    const trigger = root.add(new El({ "data-el": "filter.map" }));
    trigger.add(new El({ "data-part": "trigger", "aria-expanded": "true" }));

    const { contexts, openPopups } = resolveActiveContexts(baseEnv, asRoot(root));
    expect(openPopups).toEqual([{ id: "mapFilter", mode: "region" }]);
    expect(contexts).toContain("popup:mapFilter");
    expect(contexts).toContain("popup:region");
  });

  it("ignores a closed popup trigger", () => {
    const root = new El();
    const trigger = root.add(new El({ "data-el": "filter.map" }));
    trigger.add(new El({ "data-part": "trigger", "aria-expanded": "false" }));
    const { openPopups } = resolveActiveContexts(baseEnv, asRoot(root));
    expect(openPopups).toEqual([]);
  });
});

describe("resolveRequiredElements", () => {
  it("maps active contexts to their required element ids", () => {
    const required = resolveRequiredElements(["views", "views+settings", "view:browser", "withJoin"]);
    expect([...required.keys()]).toEqual(
      expect.arrayContaining(["nav.servers", "app.close", "filter.search", "server.actionNotice"]),
    );
    expect(required.get("nav.servers")).toEqual(["views"]);
    expect(required.get("server.actionNotice")).toEqual(["withJoin"]);
    expect(required.has("settings.back")).toBe(false);
    expect(required.has("update.install")).toBe(false);
  });

  it("requires modal contents only for the open modal", () => {
    const required = resolveRequiredElements(["modal", "modal:update"]);
    expect(required.get("update.install")).toEqual(["modal:update"]);
    expect(required.get("modal.close")).toEqual(["modal"]);
    expect(required.has("modFilter.apply")).toBe(false);
  });

  it("requires popup contents and close for an open region popup", () => {
    const required = resolveRequiredElements(["popup:mapFilter", "popup:region"]);
    expect(required.has("popup.mapOptions")).toBe(true);
    expect(required.get("popup.close")).toEqual(["popup:region"]);
  });
});

describe("attributeElement", () => {
  const active: ActiveContexts = {
    contexts: ["views", "views+settings", "view:browser", "list:servers/row", "withJoin"],
    openModals: [],
    openPopups: [],
  };

  it("prefers the theme-owned file that actually places the element", () => {
    installTheme("local.test", {
      ...shellOnly,
      [BROWSER]: layoutWith("filter.search"),
    });
    expect(attributeElement("filter.search", ["view:browser"], active)).toEqual({
      file: BROWSER,
      placed: true,
    });
  });

  it("blames the context's file when the element is missing from the theme entirely", () => {
    installTheme("local.test", { ...shellOnly, [BROWSER]: layoutWith("list.servers") });
    expect(attributeElement("filter.search", ["view:browser"], active)).toEqual({
      file: BROWSER,
      placed: false,
    });
  });

  it("attributes withJoin to the same file as server.join", () => {
    installTheme("local.test", {
      ...shellOnly,
      [SERVER_LIST]: layoutWith("server.join", "server.actionNotice"),
    });
    expect(attributeElement("server.actionNotice", ["withJoin"], active)).toEqual({
      file: SERVER_LIST,
      placed: true,
    });
  });

  it("marks nothing for Neutral, which owns no files", () => {
    useThemeStore.setState({ activeId: "neutral", themeFiles: {} });
    expect(attributeElement("filter.search", ["view:browser"], active)).toBeUndefined();
  });

  it("marks nothing when no theme file could place the element", () => {
    installTheme("local.test", shellOnly);
    expect(attributeElement("filter.search", ["view:browser"], active)).toBeUndefined();
  });

  it("never marks a file that already fell back", () => {
    installTheme("local.test", { ...shellOnly, [BROWSER]: layoutWith("filter.search") });
    useFallbackStore.setState({ fallbackFiles: { [BROWSER]: true } });
    expect(attributeElement("filter.search", ["view:browser"], active)).toBeUndefined();
  });
});

describe("applyVisibilityCheck", () => {
  beforeEach(() => {
    visibility.runVisibilityCheck.mockReset();
  });

  it("records a measure entry for each pass", () => {
    installTheme("local.test", shellOnly);
    visibility.runVisibilityCheck.mockReturnValue({ passed: true, failures: [] });

    applyVisibilityCheck({ env: baseEnv, themeId: "local.test", root: asRoot(browserTree()) });

    expect(performance.getEntriesByName(VISIBILITY_CHECK_MEASURE)).toHaveLength(1);
    const [call] = visibility.runVisibilityCheck.mock.calls;
    expect(call[0].requiredElements).toEqual(expect.arrayContaining(["nav.servers"]));
  });

  it("marks the attributed file with `<element>: <reason>`", () => {
    installTheme("local.test", { ...shellOnly, [BROWSER]: layoutWith("filter.search") });
    visibility.runVisibilityCheck.mockReturnValue({
      passed: false,
      failures: [{ element: "filter.search", reason: "dimensions are zero or negative" }],
    });

    applyVisibilityCheck({ env: baseEnv, themeId: "local.test", root: asRoot(browserTree()) });

    expect(useFallbackStore.getState().fallbackReasons[BROWSER]).toEqual([
      "filter.search: dimensions are zero or negative",
    ]);
    expect(useFallbackStore.getState().fallbackFiles[BROWSER]).toBe(true);
  });

  it("blames a theme-owned file that omits the element entirely", () => {
    installTheme("local.test", { ...shellOnly, [BROWSER]: layoutWith("list.servers") });
    visibility.runVisibilityCheck.mockReturnValue({
      passed: false,
      failures: [{ element: "filter.search", reason: "Element not found in document" }],
    });

    applyVisibilityCheck({ env: baseEnv, themeId: "local.test", root: asRoot(browserTree()) });

    expect(useFallbackStore.getState().fallbackReasons[BROWSER]).toEqual([
      "filter.search: Element not found in document",
    ]);
  });

  it("leaves a required element the launcher chose not to mount alone", () => {
    installTheme("local.test", { ...shellOnly, [BROWSER]: layoutWith("filter.search") });
    visibility.runVisibilityCheck.mockReturnValue({
      passed: false,
      failures: [{ element: "filter.search", reason: "Element not found in document" }],
    });

    applyVisibilityCheck({ env: baseEnv, themeId: "local.test", root: asRoot(browserTree()) });

    expect(useFallbackStore.getState().fallbackFiles).toEqual({});
  });

  it("skips the pass while the theme owns no shell (legacy components render)", () => {
    useThemeStore.setState({ activeId: "neutral", themeFiles: {} });
    applyVisibilityCheck({ env: baseEnv, themeId: "neutral", root: asRoot(browserTree()) });
    expect(visibility.runVisibilityCheck).not.toHaveBeenCalled();
  });
});

describe("startVisibilityChecks", () => {
  let rafQueue: FrameRequestCallback[] = [];
  let observerCallback: ((mutations: { target: unknown }[]) => void) | null = null;
  const windowListeners: Record<string, () => void> = {};

  beforeEach(() => {
    visibility.runVisibilityCheck.mockReset();
    rafQueue = [];
    observerCallback = null;
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
      clearTimeout: (id: unknown) => clearTimeout(id as never),
      addEventListener: (type: string, fn: () => void) => void (windowListeners[type] = fn),
      removeEventListener: (type: string) => void delete windowListeners[type],
    });
    vi.stubGlobal("document", { fonts: { ready: Promise.resolve() }, body: {} });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(cb: (mutations: { target: unknown }[]) => void) {
          observerCallback = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearFallbacks();
  });

  /** Let the debounce fire, then run the pass's two post-paint frames. */
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS + 50);
    for (let frame = 0; frame < 2; frame += 1) {
      rafQueue.splice(0).forEach((cb) => cb(0));
      await Promise.resolve();
    }
  }

  it("runs once after paint on start", async () => {
    const onRun = vi.fn();
    const stop = startVisibilityChecks({ getEnv: () => baseEnv, getThemeId: () => "local.test", root: asRoot(browserTree()), onRun });

    expect(onRun).not.toHaveBeenCalled();
    await settle();
    expect(onRun).toHaveBeenCalledTimes(1);
    stop();
  });

  it("debounces window resize to one pass", async () => {
    const onRun = vi.fn();
    startVisibilityChecks({ getEnv: () => baseEnv, getThemeId: () => "local.test", root: asRoot(browserTree()), onRun });
    await settle();

    windowListeners.resize();
    await vi.advanceTimersByTimeAsync(RESIZE_DEBOUNCE_MS - 50);
    windowListeners.resize();
    await settle();

    expect(onRun).toHaveBeenCalledTimes(2);
  });

  it("re-runs on tab, accordion and popup trigger changes only", async () => {
    const onRun = vi.fn();
    startVisibilityChecks({ getEnv: () => baseEnv, getThemeId: () => "local.test", root: asRoot(browserTree()), onRun });
    await settle();

    const tab = new El({ role: "tab", "aria-selected": "true" });
    observerCallback?.([{ target: tab }]);
    await settle();
    expect(onRun).toHaveBeenCalledTimes(2);

    const accordion = new El({ "data-accordion": "settings" });
    const header = accordion.add(new El({ "aria-expanded": "true" }));
    observerCallback?.([{ target: header }]);
    await settle();
    expect(onRun).toHaveBeenCalledTimes(3);

    const trigger = new El({ "data-part": "trigger", "aria-expanded": "true" });
    observerCallback?.([{ target: trigger }]);
    await settle();
    expect(onRun).toHaveBeenCalledTimes(4);
  });

  it("never runs on list row selection or server data updates", async () => {
    const onRun = vi.fn();
    startVisibilityChecks({ getEnv: () => baseEnv, getThemeId: () => "local.test", root: asRoot(browserTree()), onRun });
    await settle();

    const row = new El({ role: "row", "aria-selected": "true" });
    observerCallback?.([{ target: row }]);
    useServerStore.setState({ servers: [] });
    await settle();

    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe("host attributes the check reads", () => {
  it("renders data-modal-host and a dialog role", () => {
    const html = renderToStaticMarkup(createElement(ModalHost, { file: SERVER_INFO_MODAL, onClose: () => {} }));
    expect(html).toContain("data-modal-host");
    expect(html).toContain('role="dialog"');
  });

  it("renders data-settings-host with its presentation mode", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsHost, { file: { ...SETTINGS_LAYOUT, presentation: { mode: "overlay" } }, onClose: () => {} }),
    );
    expect(html).toContain('data-settings-host="" data-presentation="overlay"');
  });
});
