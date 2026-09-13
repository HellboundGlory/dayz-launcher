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
    const el = node({ "data-tetra-slot": "filterBar" });

    expect(findTetraNode(el)).toMatchObject({ id: "filterBar", kind: "slot", element: el });
  });

  it("stops at the nearest tagged ancestor", () => {
    const slot = node({ "data-tetra-slot": "server.row" });
    const child = node({ "data-tetra-el": "name" }, slot);

    expect(findTetraNode(node({}, child))).toMatchObject({
      id: "name",
      kind: "el",
      element: child,
    });
  });

  it("keeps walking past untagged wrappers up to a slot container", () => {
    const slot = node({ "data-tetra-slot": "shell.sidebar" });

    expect(findTetraNode(node({}, node({}, slot)))).toMatchObject({
      id: "shell.sidebar",
      kind: "slot",
    });
  });

  it("reads the inner tag first when both ancestors are tagged", () => {
    const header = node({ "data-tetra-slot": "shell.header" });
    const dragRegion = node({ "data-tetra-el": "dragRegion" }, header);

    expect(findTetraNode(dragRegion)).toMatchObject({ id: "dragRegion", kind: "el" });
    expect(findTetraNode(dragRegion.parentElement)).toMatchObject({
      id: "shell.header",
      kind: "slot",
    });
  });

  it("prefers the slot id when one node carries both attributes", () => {
    const both = node({ "data-tetra-slot": "shell.header", "data-tetra-el": "dragRegion" });

    expect(findTetraNode(both)).toMatchObject({ id: "shell.header", kind: "slot" });
  });

  it("returns null when nothing in the tree is tagged, or there is no start", () => {
    expect(findTetraNode(null)).toBeNull();
    expect(findTetraNode(node({}, node({})))).toBeNull();
  });
});

describe("selectorFor", () => {
  it("builds the selector that matches the tagged element", () => {
    const slot: TetraNode = { id: "server.row", kind: "slot", element: node({}) };
    const el: TetraNode = { id: "joinAction", kind: "el", element: node({}) };

    expect(selectorFor(slot)).toBe('[data-tetra-slot="server.row"]');
    expect(selectorFor(el)).toBe('[data-tetra-el="joinAction"]');
  });
});
