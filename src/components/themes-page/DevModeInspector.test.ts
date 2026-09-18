/** The hover-target walk: from a pointer target up to the nearest element the
 * theming system has tagged, which is what the inspector outlines. */
import { describe, expect, it } from "vitest";
import { findTetraNode, selectorFor, type TetraNode } from "./DevModeInspector";

/** Only the attribute/parent surface the walk touches, so these stay in the
 * default node environment. */
function node(attrs: Record<string, string>, parent: Element | null = null): Element {
  return {
    parentElement: parent,
    hasAttribute: (name: string) => name in attrs,
    getAttribute: (name: string) => attrs[name] ?? null,
  } as unknown as Element;
}

describe("findTetraNode", () => {
  it("returns the element itself when it carries the attribute", () => {
    const el = node({ "data-surface": "surface.filterBar" });

    expect(findTetraNode(el)).toMatchObject({ id: "surface.filterBar", kind: "surface", element: el });
  });

  it("finds region nodes via data-region or container id", () => {
    const regionData = node({ "data-region": "r-detail" });
    const regionId = node({ id: "r-sidebar" });

    expect(findTetraNode(regionData)).toMatchObject({ id: "r-detail", kind: "region", element: regionData });
    expect(findTetraNode(regionId)).toMatchObject({ id: "r-sidebar", kind: "region", element: regionId });
  });

  it("finds element parts and detects enclosing element id as partOf", () => {
    const parentEl = node({ "data-el": "server.players" });
    const part = node({ "data-part": "caption" }, parentEl);

    expect(findTetraNode(part)).toMatchObject({
      id: "caption",
      kind: "part",
      element: part,
      partOf: "server.players",
    });
  });

  it("detects nearest enclosing context", () => {
    const contextContainer = node({ "data-context": "selection" });
    const el = node({ "data-el": "server.name" }, contextContainer);

    expect(findTetraNode(el)).toMatchObject({
      id: "server.name",
      kind: "el",
      element: el,
      context: "selection",
    });
  });

  it("detects context directly on the node itself", () => {
    const el = node({ "data-el": "server.name", "data-context": "selection" });

    expect(findTetraNode(el)).toMatchObject({
      id: "server.name",
      kind: "el",
      element: el,
      context: "selection",
    });
  });

  it("stops at the nearest tagged ancestor", () => {
    const surface = node({ "data-surface": "surface.serverBrowser" });
    const child = node({ "data-el": "name" }, surface);

    expect(findTetraNode(node({}, child))).toMatchObject({
      id: "name",
      kind: "el",
      element: child,
    });
  });

  it("keeps walking past untagged wrappers up to a surface container", () => {
    const surface = node({ "data-surface": "surface.navRail" });

    expect(findTetraNode(node({}, node({}, surface)))).toMatchObject({
      id: "surface.navRail",
      kind: "surface",
    });
  });

  it("reads the inner tag first when both ancestors are tagged", () => {
    const header = node({ "data-surface": "surface.windowControls" });
    const dragRegion = node({ "data-el": "app.dragRegion" }, header);

    expect(findTetraNode(dragRegion)).toMatchObject({ id: "app.dragRegion", kind: "el" });
    expect(findTetraNode(dragRegion.parentElement)).toMatchObject({
      id: "surface.windowControls",
      kind: "surface",
    });
  });

  it("prefers the surface id when one node carries both attributes", () => {
    const both = node({ "data-surface": "surface.windowControls", "data-el": "app.dragRegion" });

    expect(findTetraNode(both)).toMatchObject({ id: "surface.windowControls", kind: "surface" });
  });

  it("returns null when nothing in the tree is tagged, or there is no start", () => {
    expect(findTetraNode(null)).toBeNull();
    expect(findTetraNode(node({}, node({})))).toBeNull();
  });
});

describe("selectorFor", () => {
  it("builds the selector that matches the tagged element", () => {
    const surface: TetraNode = { id: "surface.serverBrowser", kind: "surface", element: node({}) };
    const el: TetraNode = { id: "joinAction", kind: "el", element: node({}) };

    expect(selectorFor(surface)).toBe('[data-surface="surface.serverBrowser"]');
    expect(selectorFor(el)).toBe('[data-el="joinAction"]');
  });

  it("builds scoped selector when element is in context", () => {
    const el: TetraNode = { id: "server.name", kind: "el", element: node({}), context: "selection" };

    expect(selectorFor(el)).toBe('[data-context="selection"] [data-el="server.name"]');
  });

  it("builds selector for element part with and without context", () => {
    const part: TetraNode = {
      id: "caption",
      kind: "part",
      element: node({}),
      partOf: "server.players",
    };

    expect(selectorFor(part)).toBe('[data-el="server.players"] [data-part="caption"]');

    const partInContext: TetraNode = {
      ...part,
      context: "selection",
    };

    expect(selectorFor(partInContext)).toBe('[data-context="selection"] [data-el="server.players"] [data-part="caption"]');
  });

  it("builds selector for region nodes", () => {
    const regionData: TetraNode = {
      id: "r-detail",
      kind: "region",
      element: node({ "data-region": "r-detail" }),
    };

    expect(selectorFor(regionData)).toBe('[data-region="r-detail"]');

    const regionId: TetraNode = {
      id: "r-sidebar",
      kind: "region",
      element: node({ id: "r-sidebar" }),
    };

    expect(selectorFor(regionId)).toBe('#r-sidebar');
  });
});
