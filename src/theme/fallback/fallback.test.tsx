import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BoxNode, LayoutFile, LayoutNode } from "../renderer/types";
import {
  applyAutoPlacement,
  isElementInLayout,
  isElementInNode,
  getMissingRequiredElements,
  resolveFallbackPlacement,
} from "./auto-placement";
import {
  checkElementVisibility,
  runVisibilityCheck,
} from "./visibility";
import {
  useFallbackStore,
  markFileFallback,
  isFileFallenBack,
  clearFallbacks,
  isFallbackNoticeDismissed,
  dismissFallbackNotice,
  clearFallbackMemory,
} from "./store";
import { FallbackNotice } from "./fallback-notice";

interface MockRect {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

class MockHTMLElement {
  tagName: string;
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: MockHTMLElement[] = [];
  parentElement: MockHTMLElement | null = null;
  textContent: string = "";
  tabIndex: number = 0;
  disabled: boolean = false;
  rect: MockRect = { width: 100, height: 40, top: 100, bottom: 140, left: 100, right: 200 };
  classList = {
    contains: (cls: string) => (this.attributes.get("class") ?? "").split(/\s+/).includes(cls),
  };

  constructor(tagName: string = "div") {
    this.tagName = tagName.toUpperCase();
  }

  get innerText(): string {
    return this.textContent;
  }
  set innerText(val: string) {
    this.textContent = val;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "tabindex") {
      this.tabIndex = parseInt(value, 10);
    }
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild<T extends MockHTMLElement>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getBoundingClientRect(): MockRect {
    return this.rect;
  }

  contains(other: MockHTMLElement | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    let curr = other.parentElement;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  matches(selector: string): boolean {
    const alternatives = selector.split(",").map((s) => s.trim());
    return alternatives.some((alt) => {
      const attrMatches = alt.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g);
      if (!attrMatches) return false;
      return attrMatches.every((attr) => {
        const m = attr.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
        if (!m) return false;
        const [, attrName, attrVal] = m;
        if (attrVal !== undefined) {
          return this.getAttribute(attrName) === attrVal;
        }
        return this.hasAttribute(attrName);
      });
    });
  }

  closest(selector: string): MockHTMLElement | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  querySelector(selector: string): MockHTMLElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockHTMLElement[] {
    const results: MockHTMLElement[] = [];
    const walk = (node: MockHTMLElement) => {
      if (node !== this && node.matches(selector)) {
        results.push(node);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    for (const child of this.children) {
      walk(child);
    }
    return results;
  }
}

const mockDocument = {
  activeElement: null as MockHTMLElement | null,
  elementFromPoint: vi.fn(() => null as MockHTMLElement | null),
  createElement: (tag: string) => new MockHTMLElement(tag),
  querySelector: () => null as MockHTMLElement | null,
  querySelectorAll: () => [] as MockHTMLElement[],
};

const mockWindow = {
  innerWidth: 1024,
  innerHeight: 768,
  getComputedStyle: (el: MockHTMLElement) => el.style,
};

describe("Theme Fallback & Visibility (Package 4.5)", () => {
  beforeEach(() => {
    clearFallbackMemory();
    vi.stubGlobal("document", mockDocument);
    vi.stubGlobal("window", mockWindow);
    mockDocument.activeElement = null;
    mockDocument.elementFromPoint = vi.fn().mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Auto-Placement (§6.8, §16.2)", () => {
    it("appends element node when fallbackPlacement is 'append'", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          direction: "column",
          children: [
            { element: "server.name" },
          ],
        },
      };

      const result = applyAutoPlacement(layout, "list:servers/row", ["server.join"]);
      expect(result.autoPlaced).toEqual([
        { element: "server.join", placement: "append" },
      ]);

      const root = result.layout.root as { children: LayoutNode[] };
      expect(root.children).toHaveLength(2);
      expect(root.children[1]).toEqual({ element: "server.join" });
    });

    it("wraps non-container root in a box when appending", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          element: "server.name",
        },
      };

      const result = applyAutoPlacement(layout, "list:servers/row", ["server.join"]);
      expect(result.autoPlaced).toHaveLength(1);
      expect((result.layout.root as BoxNode)?.type).toBe("box");
      const root = result.layout.root as { children: LayoutNode[] };
      expect(root.children).toHaveLength(2);
      expect(root.children[0]).toEqual({ element: "server.name" });
      expect(root.children[1]).toEqual({ element: "server.join" });
    });

    it("inserts after target element with 'afterElement:<targetId>'", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          direction: "row",
          children: [
            { element: "server.name" },
            { element: "server.join" },
            { element: "server.ping" },
          ],
        },
      };

      const result = applyAutoPlacement(layout, "list:servers/row", ["server.actionNotice"]);
      expect(result.autoPlaced).toEqual([
        { element: "server.actionNotice", placement: "afterElement:server.join" },
      ]);

      const root = result.layout.root as { children: { element?: string }[] };
      expect(root.children.map((c) => c.element)).toEqual([
        "server.name",
        "server.join",
        "server.actionNotice",
        "server.ping",
      ]);
    });

    it("finds target element inside nested containers for 'afterElement'", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          direction: "column",
          children: [
            {
              type: "box",
              children: [
                { element: "server.join" },
              ],
            },
          ],
        },
      };

      const result = applyAutoPlacement(layout, "list:servers/row", ["server.actionNotice"]);
      expect(result.autoPlaced).toHaveLength(1);

      const root = result.layout.root as { children: { children: { element?: string }[] }[] };
      expect(root.children[0].children.map((c) => c.element)).toEqual([
        "server.join",
        "server.actionNotice",
      ]);
    });

    it("falls back to append if afterElement target is not in layout", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          children: [
            { element: "server.name" },
          ],
        },
      };

      const result = applyAutoPlacement(layout, "afterElement:missing.target", ["server.actionNotice"]);
      expect(result.autoPlaced).toHaveLength(1);
      const root = result.layout.root as { children: LayoutNode[] };
      expect(root.children).toHaveLength(2);
      expect(root.children[1]).toEqual({ element: "server.actionNotice" });
    });

    it("inserts positioned node with 'anchor:<anchor>'", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "box",
          children: [
            { element: "server.name" },
          ],
        },
      };

      const result = applyAutoPlacement(layout, "anchor:topRight", ["app.close"]);
      expect(result.autoPlaced).toEqual([
        { element: "app.close", placement: "anchor:topRight" },
      ]);

      const root = result.layout.root as { children: LayoutNode[] };
      expect(root.children).toHaveLength(2);
      expect(root.children[1]).toEqual({
        element: "app.close",
        position: { anchor: "topRight" },
      });
    });

    it("leaves layout unchanged when required element is already placed", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          children: [
            { element: "server.join" },
            { element: "server.actionNotice" },
          ],
        },
      };

      const result = applyAutoPlacement(layout, "list:servers/row", ["server.join", "server.actionNotice"]);
      expect(result.autoPlaced).toHaveLength(0);
      expect(result.layout).toBe(layout);
    });

    it("recognizes element inside surface as placed", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "box",
          children: [
            { surface: "surface.windowControls" },
          ],
        },
      };

      // app.close is contained in surface.windowControls
      expect(isElementInLayout(layout, "app.close")).toBe(true);
      const result = applyAutoPlacement(layout, "views", ["app.close"]);
      expect(result.autoPlaced).toHaveLength(0);
    });

    it("auto-detects missing required elements when not explicitly passed", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          children: [
            { element: "server.join" },
          ],
        },
      };

      const missing = getMissingRequiredElements(layout, "withJoin");
      expect(missing).toContain("server.actionNotice");

      const result = applyAutoPlacement(layout, "withJoin");
      expect(result.autoPlaced.some((a) => a.element === "server.actionNotice")).toBe(true);
    });

    it("does not mutate the original layout file", () => {
      const layout: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          children: [{ element: "server.name" }],
        },
      };

      const result = applyAutoPlacement(layout, "list:servers/row", ["server.join"]);
      expect(result.layout).not.toBe(layout);
      const originalRoot = layout.root as { children: LayoutNode[] };
      expect(originalRoot.children).toHaveLength(1);
    });

    it("evaluates isElementInNode and resolveFallbackPlacement utilities directly", () => {
      expect(isElementInNode({ element: "server.join" }, "server.join")).toBe(true);
      expect(isElementInNode({ element: "server.join" }, "server.ping")).toBe(false);
      expect(resolveFallbackPlacement("server.join", "list:servers/row")).toBe("append");
      expect(resolveFallbackPlacement("server.actionNotice", "withJoin")).toBe("afterElement:server.join");
    });
  });

  describe("Visibility Check (§15)", () => {
    function createMockElement(options: {
      tag?: string;
      rect?: MockRect;
      style?: Record<string, string>;
      attributes?: Record<string, string>;
      disabled?: boolean;
      tabIndex?: number;
    }) {
      const el = new MockHTMLElement(options.tag ?? "div");
      const defaultRect = { width: 100, height: 40, top: 100, bottom: 140, left: 100, right: 200 };
      el.rect = options.rect ?? defaultRect;

      if (options.style) {
        Object.assign(el.style, options.style);
      }

      if (options.attributes) {
        for (const [k, v] of Object.entries(options.attributes)) {
          el.setAttribute(k, v);
        }
      }

      if (options.disabled !== undefined) {
        el.disabled = options.disabled;
      }

      if (options.tabIndex !== undefined) {
        el.tabIndex = options.tabIndex;
      }

      return el as unknown as HTMLElement;
    }

    it("passes for a fully visible and properly bounded element", () => {
      const el = createMockElement({});
      const res = checkElementVisibility(el);
      expect(res.visible).toBe(true);
      expect(res.reason).toBeUndefined();
    });

    it("fails when dimensions are zero or negative", () => {
      const zeroWidth = createMockElement({ rect: { width: 0, height: 40, top: 10, bottom: 50, left: 10, right: 10 } });
      expect(checkElementVisibility(zeroWidth)).toEqual({
        visible: false,
        reason: "dimensions are zero or negative",
      });

      const zeroHeight = createMockElement({ rect: { width: 40, height: 0, top: 10, bottom: 10, left: 10, right: 50 } });
      expect(checkElementVisibility(zeroHeight)).toEqual({
        visible: false,
        reason: "dimensions are zero or negative",
      });
    });

    it("fails when element is outside viewport bounds", () => {
      const bounds = { width: 1000, height: 800 };

      const above = createMockElement({ rect: { width: 50, height: 50, top: -100, bottom: -50, left: 10, right: 60 } });
      expect(checkElementVisibility(above, bounds)).toEqual({
        visible: false,
        reason: "outside window bounds",
      });

      const below = createMockElement({ rect: { width: 50, height: 50, top: 850, bottom: 900, left: 10, right: 60 } });
      expect(checkElementVisibility(below, bounds)).toEqual({
        visible: false,
        reason: "outside window bounds",
      });

      const toLeft = createMockElement({ rect: { width: 50, height: 50, top: 10, bottom: 60, left: -100, right: -50 } });
      expect(checkElementVisibility(toLeft, bounds)).toEqual({
        visible: false,
        reason: "outside window bounds",
      });

      const toRight = createMockElement({ rect: { width: 50, height: 50, top: 10, bottom: 60, left: 1050, right: 1100 } });
      expect(checkElementVisibility(toRight, bounds)).toEqual({
        visible: false,
        reason: "outside window bounds",
      });
    });

    it("fails when styles hide the element", () => {
      const none = createMockElement({ style: { display: "none" } });
      expect(checkElementVisibility(none).visible).toBe(false);

      const hidden = createMockElement({ style: { visibility: "hidden" } });
      expect(checkElementVisibility(hidden).visible).toBe(false);

      const collapsed = createMockElement({ style: { visibility: "collapse" } });
      expect(checkElementVisibility(collapsed).visible).toBe(false);

      const transparent = createMockElement({ style: { opacity: "0" } });
      expect(checkElementVisibility(transparent).visible).toBe(false);
    });

    it("fails when center point is occluded by another element", () => {
      const el = createMockElement({});
      const otherEl = document.createElement("div");

      document.elementFromPoint = vi.fn().mockReturnValue(otherEl);

      const res = checkElementVisibility(el);
      expect(res.visible).toBe(false);
      expect(res.reason).toContain("occluded");
    });

    it("passes when elementFromPoint returns the element or its descendant", () => {
      const el = createMockElement({});
      const child = document.createElement("span");
      el.appendChild(child);

      document.elementFromPoint = vi.fn().mockReturnValue(child);
      expect(checkElementVisibility(el).visible).toBe(true);

      document.elementFromPoint = vi.fn().mockReturnValue(el);
      expect(checkElementVisibility(el).visible).toBe(true);
    });

    it("fails an interactive element with negative tabIndex, not one the launcher disabled", () => {
      // ELEMENTS.md: required actions are routinely `disabled` while busy, playing or
      // with nothing to act on. Enablement isn't a layout fault a theme could fix.
      expect(checkElementVisibility(createMockElement({ tag: "button", disabled: true }))).toEqual({
        visible: true,
      });

      expect(
        checkElementVisibility(
          createMockElement({ tag: "button", attributes: { "aria-disabled": "true" } }),
        ),
      ).toEqual({ visible: true });

      const btnTabDisabled = createMockElement({ tag: "button", tabIndex: -1 });
      expect(checkElementVisibility(btnTabDisabled)).toEqual({
        visible: false,
        reason: "interactive element has tabIndex === -1",
      });
    });

    it("passes a required element the launcher disabled", () => {
      const container = document.createElement("div");
      container.appendChild(
        createMockElement({
          tag: "button",
          attributes: { "data-el": "update.install" },
          disabled: true,
        }),
      );

      expect(runVisibilityCheck({ root: container, requiredElements: ["update.install"] }).passed).toBe(
        true,
      );
    });

    it("runVisibilityCheck checks required elements and reports missing", () => {
      const container = document.createElement("div");
      const btn = createMockElement({
        tag: "button",
        attributes: { "data-el": "server.join" },
      });
      container.appendChild(btn);

      // An unshown action notice is not a failure: it renders only when it has something to say.
      expect(
        runVisibilityCheck({ root: container, requiredElements: ["server.join", "server.actionNotice"] })
          .passed,
      ).toBe(true);

      const empty = document.createElement("div");
      const result = runVisibilityCheck({ root: empty, requiredElements: ["server.join"] });

      expect(result.passed).toBe(false);
      expect(result.failures).toEqual([
        { element: "server.join", reason: "Element not found in document" },
      ]);
    });

    it("skips unshown notices during visibility check", () => {
      const container = document.createElement("div");

      // Empty notice in DOM
      const notice = createMockElement({
        attributes: { "data-el": "notice.error" },
      });
      notice.textContent = "";
      container.appendChild(notice);

      const result = runVisibilityCheck({
        root: container,
        requiredElements: ["notice.error"],
      });

      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("skips elements in unselected/unfocused list rows, measures selected row", () => {
      const container = document.createElement("div");

      // Unselected row
      const unselectedRow = document.createElement("div");
      unselectedRow.setAttribute("role", "row");
      const unselectedJoin = createMockElement({
        tag: "button",
        rect: { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 },
        attributes: { "data-el": "server.join" },
      });
      unselectedRow.appendChild(unselectedJoin);
      container.appendChild(unselectedRow);

      // Selected row
      const selectedRow = document.createElement("div");
      selectedRow.setAttribute("role", "row");
      selectedRow.setAttribute("data-state", "selected");
      const selectedJoin = createMockElement({
        tag: "button",
        attributes: { "data-el": "server.join" },
      });
      selectedRow.appendChild(selectedJoin);
      container.appendChild(selectedRow);

      const result = runVisibilityCheck({ root: container });
      expect(result.passed).toBe(true);
    });

    it("skips elements inside closed accordion sections or inactive tab panels", () => {
      const container = document.createElement("div");

      const closedSection = document.createElement("div");
      closedSection.setAttribute("data-section", "advanced");
      closedSection.setAttribute("data-state", "closed");
      const brokenElement = createMockElement({
        rect: { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 },
        attributes: { "data-el": "server.advancedSetting" },
      });
      closedSection.appendChild(brokenElement);
      container.appendChild(closedSection);

      const hiddenTab = document.createElement("div");
      hiddenTab.setAttribute("role", "tabpanel");
      hiddenTab.setAttribute("hidden", "");
      const tabElement = createMockElement({
        style: { display: "none" },
        attributes: { "data-el": "server.tabDetails" },
      });
      hiddenTab.appendChild(tabElement);
      container.appendChild(hiddenTab);

      const result = runVisibilityCheck({ root: container });
      expect(result.passed).toBe(true);
    });

    it("isolates modal when open: only checks modal elements", () => {
      const container = document.createElement("div");

      // Page element with zero dimensions
      const pageEl = createMockElement({
        rect: { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 },
        attributes: { "data-el": "nav.servers" },
      });
      container.appendChild(pageEl);

      // Modal container
      const modalHost = document.createElement("div");
      modalHost.setAttribute("data-modal-host", "");
      const modalBtn = createMockElement({
        tag: "button",
        attributes: { "data-el": "modal.close" },
      });
      modalHost.appendChild(modalBtn);
      container.appendChild(modalHost);

      const result = runVisibilityCheck({
        root: container,
        isModalOpen: true,
        requiredElements: ["nav.servers", "modal.close"],
      });

      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("isolates settings overlay: skips underlying view but checks window chrome", () => {
      const container = document.createElement("div");

      // Underlying view element with zero dimensions
      const viewEl = createMockElement({
        rect: { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 },
        attributes: { "data-el": "filter.search" },
      });
      container.appendChild(viewEl);

      // Window controls (must not be skipped)
      const closeBtn = createMockElement({
        tag: "button",
        attributes: { "data-el": "app.close" },
      });
      container.appendChild(closeBtn);

      // Settings overlay
      const settingsHost = document.createElement("div");
      settingsHost.setAttribute("data-settings-host", "");
      settingsHost.setAttribute("data-presentation", "overlay");
      const settingItem = createMockElement({
        attributes: { "data-el": "setting.option" },
      });
      settingsHost.appendChild(settingItem);
      container.appendChild(settingsHost);

      const result = runVisibilityCheck({
        root: container,
        isSettingsOpen: true,
        settingsPresentation: "overlay",
      });

      expect(result.passed).toBe(true);
    });
  });

  describe("Fallback Store & Persistence", () => {
    it("marks and checks file fallbacks", () => {
      expect(isFileFallenBack("layout/views/browser.json")).toBe(false);

      markFileFallback("custom.dark", "layout/views/browser.json", "zero height");
      expect(isFileFallenBack("layout/views/browser.json")).toBe(true);
      expect(isFileFallenBack("layout/views/mods.json")).toBe(false);

      const state = useFallbackStore.getState();
      expect(state.fallbackReasons["layout/views/browser.json"]).toEqual(["zero height"]);

      clearFallbacks();
      expect(isFileFallenBack("layout/views/browser.json")).toBe(false);
    });

    it("persists fallback notice dismissal per theme and version", () => {
      expect(isFallbackNoticeDismissed("theme1", "2.6.0")).toBe(false);

      dismissFallbackNotice("theme1", "2.6.0");
      expect(isFallbackNoticeDismissed("theme1", "2.6.0")).toBe(true);

      // Different version or theme is not dismissed
      expect(isFallbackNoticeDismissed("theme1", "2.7.0")).toBe(false);
      expect(isFallbackNoticeDismissed("theme2", "2.6.0")).toBe(false);
    });
  });

  describe("FallbackNotice Component", () => {
    it("renders nothing when no file has fallen back", () => {
      const html = renderToStaticMarkup(<FallbackNotice themeId="t1" launcherVersion="2.6.0" />);
      expect(html).toBe("");
    });

    it("renders banner with message and dismiss button when a file has fallen back", () => {
      markFileFallback("t1", "layout/views/browser.json", "fail");

      const html = renderToStaticMarkup(<FallbackNotice themeId="t1" launcherVersion="2.6.0" />);
      expect(html).toContain('data-part="fallback-notice"');
      expect(html).toContain('role="status"');
      expect(html).toContain("One or more screens could not be displayed with the current theme layout and fell back to default");
      expect(html).toContain('data-part="dismiss"');
    });

    it("renders nothing after notice is dismissed", () => {
      markFileFallback("t1", "layout/views/browser.json", "fail");
      dismissFallbackNotice("t1", "2.6.0");

      const html = renderToStaticMarkup(<FallbackNotice themeId="t1" launcherVersion="2.6.0" />);
      expect(html).toBe("");
    });
  });
});
