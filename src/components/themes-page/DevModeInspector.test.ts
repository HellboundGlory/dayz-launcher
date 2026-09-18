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
});
