/** The hover-target walk: from a pointer target up to the nearest element the
 * theming system has tagged, which is what the inspector outlines. */
import { describe, expect, it } from "vitest";
import { findTetraNode, inHoverBridge, selectorFor, type TetraNode } from "./DevModeInspector";

/** A plain rect literal — `inHoverBridge` only reads these four fields, so a
 * real `DOMRect` isn't needed. */
function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

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

describe("inHoverBridge", () => {
  // A row at y 0-40, its badge floating 8px below at y 48-140 — the shape
  // every server/mods row badge actually takes.
  const anchor = rect(100, 0, 300, 40);
  const badgeBelow = rect(100, 48, 300, 140);

  it("covers the gap between the row and a badge below it", () => {
    expect(inHoverBridge(150, 44, anchor, badgeBelow)).toBe(true);
  });

  it("covers the badge's own footprint too, not just the gap", () => {
    expect(inHoverBridge(150, 100, anchor, badgeBelow)).toBe(true);
  });

  it("excludes a point above the row or below the badge", () => {
    expect(inHoverBridge(150, -5, anchor, badgeBelow)).toBe(false);
    expect(inHoverBridge(150, 145, anchor, badgeBelow)).toBe(false);
  });

  it("excludes a point outside either rect's horizontal span", () => {
    expect(inHoverBridge(50, 44, anchor, badgeBelow)).toBe(false);
    expect(inHoverBridge(350, 44, anchor, badgeBelow)).toBe(false);
  });

  it("mirrors the same corridor when the badge lands above the row instead", () => {
    const badgeAbove = rect(100, -100, 300, -8);
    expect(inHoverBridge(150, -50, anchor, badgeAbove)).toBe(true);
    // Inside the anchor's own body: already the current hover regardless, and
    // still within the union with the badge above it.
    expect(inHoverBridge(150, 20, anchor, badgeAbove)).toBe(true);
    expect(inHoverBridge(150, -150, anchor, badgeAbove)).toBe(false);
  });

  it("still protects the corridor when placeOverlay's clamp pulls the badge back over the anchor", () => {
    // A full-height slot (the sidebar): the badge is placed above, but
    // clamping to stay on-screen lands it overlapping the anchor's own top
    // edge rather than strictly above it.
    const tallAnchor = rect(0, 0, 200, 1000);
    const clampedBadge = rect(0, 8, 200, 148);
    expect(inHoverBridge(100, 50, tallAnchor, clampedBadge)).toBe(true);
  });

  it("doesn't protect the whole row when the badge only covers a narrow slice of it", () => {
    // A full-width server/mods row with its much narrower badge aligned to
    // the row's left edge, per placeOverlay.
    const wideRow = rect(0, 0, 1200, 40);
    const narrowBadge = rect(0, 48, 220, 140);
    expect(inHoverBridge(100, 44, wideRow, narrowBadge)).toBe(true);
    // A point elsewhere along the row, outside the badge's own footprint, is
    // a different part of the row the pointer is free to move to.
    expect(inHoverBridge(800, 20, wideRow, narrowBadge)).toBe(false);
  });
});
