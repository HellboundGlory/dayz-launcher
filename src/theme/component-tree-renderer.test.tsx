/** The shared composition renderer: the class/style derivation both rows used
 * to carry separately, plus the leaves and free placement the vocabulary added.
 * Asserted as rendered markup — what a themed slot actually emits is the thing
 * under test. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { ComponentTreeRenderer } from "./component-tree-renderer";
import type { Position, ResolvedNode } from "./component-tree";

const render = (node: ResolvedNode, nodes: Record<string, ReactNode> = {}) =>
  renderToStaticMarkup(
    <ComponentTreeRenderer node={node} nodes={nodes} themeId="aurora.theme" />,
  );

const core = (ref: string, position?: Position): ResolvedNode =>
  position === undefined ? { type: "core", ref } : { type: "core", ref, position };

const container = (props: Partial<Extract<ResolvedNode, { children: ResolvedNode[] }>>) =>
  ({ type: "stack", children: [], ...props }) as Extract<ResolvedNode, { children: ResolvedNode[] }>;

describe("ComponentTreeRenderer containers", () => {
  it("defaults a stack to a row and adds only the enums it was given", () => {
    expect(render(container({}))).toBe('<div class="flex flex-row"></div>');
    expect(render(container({ direction: "column" }))).toBe('<div class="flex flex-col"></div>');
    expect(
      render(container({ direction: "column", align: "stretch", justify: "space-between", wrap: true })),
    ).toBe('<div class="flex flex-col flex-wrap items-stretch justify-between"></div>');
  });

  it("carries gap as an inline style, never a class", () => {
    expect(render(container({ gap: "var(--space-md)" }))).toBe(
      '<div class="flex flex-row" style="gap:var(--space-md)"></div>',
    );
  });

  it("maps a grid to inline styles, ignoring wrap", () => {
    expect(
      render(
        container({
          type: "grid",
          direction: "column",
          gap: "8px",
          align: "stretch",
          justify: "end",
          wrap: true,
        }),
      ),
    ).toBe(
      '<div style="display:grid;gap:8px;grid-auto-flow:column;align-items:stretch;justify-content:end"></div>',
    );
  });

  it("gives a grid no direction default and a bare display when it has no props", () => {
    expect(render(container({ type: "grid" }))).toBe('<div style="display:grid"></div>');
  });

  it("gives a box no layout props at all — gap has no effect outside flex or grid", () => {
    expect(
      render(
        container({
          type: "box",
          gap: "8px",
          direction: "column",
          align: "center",
          justify: "end",
          wrap: true,
        }),
      ),
    ).toBe("<div></div>");
  });
});

describe("ComponentTreeRenderer", () => {
  it("renders a core leaf from the nodes map, and nothing when its data is absent", () => {
    const nodes = { name: <span>Haven</span>, pingBadge: null };

    expect(render(core("name"), nodes)).toBe("<span>Haven</span>");
    expect(render(core("pingBadge"), nodes)).toBe("");
    expect(render(core("pingBadge"))).toBe("");
  });

  it("renders a stack's children in declaration order", () => {
    const resolved = container({
      direction: "row",
      children: [core("name"), core("pingBadge"), core("playerCount")],
    });

    expect(render(resolved, { name: "A", pingBadge: "B", playerCount: "C" })).toBe(
      '<div class="flex flex-row">ABC</div>',
    );
  });

  it("renders a box as a bare div and a grid with its inline styles", () => {
    expect(render(container({ type: "box", justify: "end", children: [core("name")] }), {
      name: "A",
    })).toBe("<div>A</div>");
    expect(
      render(container({ type: "grid", gap: "6px", align: "end", children: [core("name")] }), {
        name: "A",
      }),
    ).toBe('<div style="display:grid;gap:6px;align-items:end">A</div>');
  });

  it("resolves an image leaf through the theme's own asset protocol", () => {
    const image: ResolvedNode = { type: "image", asset: "assets/icons/rank-star.svg" };

    expect(render(image)).toBe(
      '<img src="tetra-theme://aurora.theme/assets/icons/rank-star.svg" alt=""/>',
    );
  });

  it("places an image leaf without disturbing its resolved source", () => {
    const image: ResolvedNode = {
      type: "image",
      asset: "assets/icons/rank-star.svg",
      position: { anchor: "top-right", x: "-4px" },
    };

    expect(render(image)).toBe(
      '<img src="tetra-theme://aurora.theme/assets/icons/rank-star.svg" alt="" style="position:absolute;top:0;right:-4px"/>',
    );
  });

  it.each([
    // A corner anchor needs no centring transform; an edge or a centred axis does.
    ["top-left", undefined, '<div style="position:absolute;top:0;left:0">A</div>'],
    ["bottom-right", undefined, '<div style="position:absolute;bottom:0;right:0">A</div>'],
    [
      "top",
      undefined,
      '<div style="position:absolute;top:0;left:50%;transform:translateX(-50%)">A</div>',
    ],
    [
      "right",
      undefined,
      '<div style="position:absolute;top:50%;right:0;transform:translateY(-50%)">A</div>',
    ],
    [
      "center",
      undefined,
      '<div style="position:absolute;top:50%;left:50%;transform:translateY(-50%) translateX(-50%)">A</div>',
    ],
    // An offset rides on the side it names, or inside the centring transform.
    [
      "bottom-right",
      { x: "-4px", y: "-4px" },
      '<div style="position:absolute;bottom:-4px;right:-4px">A</div>',
    ],
    [
      "center",
      { x: "8px" },
      '<div style="position:absolute;top:50%;left:50%;transform:translateY(-50%) translateX(calc(-50% + 8px))">A</div>',
    ],
  ])("places a %s node free of flow", (anchor, offsets, expected) => {
    const positioned = core("name", {
      anchor,
      ...offsets,
    } as Position);

    expect(render(positioned, { name: "A" })).toBe(expected);
  });

  it("makes a container the containing block for its free-positioned children", () => {
    const resolved = container({
      direction: "row",
      children: [core("name", { anchor: "top-right" })],
    });

    expect(render(resolved, { name: "A" })).toBe(
      '<div class="flex flex-row" style="position:relative"><div style="position:absolute;top:0;right:0">A</div></div>',
    );
  });

  it("leaves a container of flow-only children with no positioning style", () => {
    expect(render(container({ gap: "4px", children: [core("name")] }), { name: "A" })).toBe(
      '<div class="flex flex-row" style="gap:4px">A</div>',
    );
  });

  it("applies a container's own position without dropping its layout", () => {
    const positioned = container({
      direction: "row",
      gap: "4px",
      position: { anchor: "top-right" },
      children: [core("name")],
    });

    expect(render(positioned, { name: "A" })).toBe(
      '<div class="flex flex-row" style="gap:4px;position:absolute;top:0;right:0">A</div>',
    );
  });
});
