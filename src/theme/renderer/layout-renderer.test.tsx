// The layout renderer, asserted as the markup a themed screen actually emits:
// variant selection, the four containers, the leaves, sizing, anchored
// positioning, landmarks, outlets and settings-driven hidden conditions.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { useDevStore } from "@/theme/dev/dev-store";
import { LayoutRenderer } from "./layout-renderer";
import { ElementContextProvider } from "../elements/context";
import type { Server } from "@/types/server";
import { resolveVariant } from "./variant";
import type { LayoutFile, LayoutNode, SettingValue } from "./types";

afterEach(() => useDevStore.getState().clear());

const file = (root: LayoutNode): LayoutFile => ({ schemaVersion: 2, root });

const render = (
  root: LayoutNode,
  props: {
    outlets?: Record<string, ReactNode>;
    renderElement?: (node: { element?: string; surface?: string }) => ReactNode;
    settings?: Record<string, SettingValue>;
    themeId?: string;
    width?: number;
  } = {},
) => renderToStaticMarkup(<LayoutRenderer file={file(root)} {...props} />);

describe("resolveVariant", () => {
  const variants: LayoutFile = {
    schemaVersion: 2,
    variants: [
      { minWidth: 0, root: { type: "box", id: "r-narrow", children: [] } },
      { minWidth: 900, root: { type: "box", id: "r-wide", children: [] } },
    ],
  };

  it("picks the highest minWidth at or below the width", () => {
    expect(resolveVariant(variants, 650).id).toBe("r-narrow");
    expect(resolveVariant(variants, 899).id).toBe("r-narrow");
    expect(resolveVariant(variants, 900).id).toBe("r-wide");
    expect(resolveVariant(variants, 1400).id).toBe("r-wide");
  });

  it("falls back to root when there are no variants", () => {
    expect(resolveVariant(file({ type: "box", id: "r-only", children: [] }), 500).id).toBe("r-only");
  });

  it("throws when a file has neither root nor variants", () => {
    expect(() => resolveVariant({ schemaVersion: 2 }, 500)).toThrow();
  });
});

describe("containers", () => {
  it("renders a childless stack, which the validator allows", () => {
    expect(render({ type: "stack", grow: 1 } as never)).toContain("display:flex");
  });

  it("lays a stack out as flex with direction, align, justify, wrap and gap", () => {
    const html = render({
      type: "stack",
      direction: "row",
      align: "center",
      justify: "spaceBetween",
      wrap: true,
      gap: "space.8",
      children: [],
    });
    expect(html).toContain("display:flex");
    expect(html).toContain("flex-direction:row");
    expect(html).toContain("align-items:center");
    expect(html).toContain("justify-content:space-between");
    expect(html).toContain("flex-wrap:wrap");
    expect(html).toContain("gap:var(--t-space-8)");
  });

  it("maps a grid to columns, areas and the gap trio", () => {
    const html = render({
      type: "grid",
      columns: ["1fr", "72px", "auto"],
      areas: ["nav main", "nav main"],
      columnGap: "space.6",
      rowGap: "rowY",
      alignItems: "end",
      justifyItems: "start",
      children: [],
    });
    expect(html).toContain("display:grid");
    expect(html).toContain("grid-template-columns:1fr 72px auto");
    expect(html).toContain('grid-template-areas:&quot;nav main&quot; &quot;nav main&quot;');
    expect(html).toContain("column-gap:var(--t-space-6)");
    expect(html).toContain("row-gap:var(--t-space-rowY)");
    expect(html).toContain("align-items:flex-end");
    expect(html).toContain("justify-items:flex-start");
  });

  it("renders a box as a bare div with no layout of its own", () => {
    expect(render({ type: "box", children: [] })).toBe("<div></div>");
  });

  it("gives a scroll container the axis overflow", () => {
    expect(render({ type: "scroll", children: [] })).toContain("overflow-y:auto");
    expect(render({ type: "scroll", axis: "x", children: [] })).toContain("overflow-x:auto");
  });

  it("renders children in declaration order", () => {
    const html = render({
      type: "stack",
      children: [
        { type: "text", value: "first" },
        { type: "text", value: "second" },
      ],
    });
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });
});

describe("contexts", () => {
  it("publishes data-context on a context container", () => {
    const selectedServer = { addr: "1.2.3.4:2303", name: "S" } as unknown as Server;
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ selectedServer }}>
        <LayoutRenderer file={file({ type: "stack", id: "r-detail", context: "selection", children: [] })} />
      </ElementContextProvider>,
    );
    expect(html).toContain('data-region="r-detail"');
    expect(html).toContain('data-context="selection"');
  });
});

describe("host nodes", () => {
  it("applies an element node's sizing props to the element itself", () => {
    const html = render({ element: "app.dragRegion", grow: 1, minWidth: "0px", minHeight: "0px", shrink: 0 });
    expect(html).toContain('data-el="app.dragRegion"');
    expect(html).toContain("flex-grow:1");
    expect(html).toContain("min-width:0px");
    expect(html).toContain("min-height:0px");
    expect(html).toContain("flex-shrink:0");
  });
});

describe("leaves", () => {
  it("renders text with its role tag and type variables", () => {
    const html = render({ type: "text", value: "REQUIRED MODS", role: "heading" });
    expect(html).toContain("<h2");
    expect(html).toContain("REQUIRED MODS");
    expect(html).toContain("font-size:var(--t-type-heading-size)");
    expect(html).toContain("font-weight:var(--t-type-heading-weight)");
    expect(html).toContain("line-height:var(--t-type-heading-leading)");
  });

  it("defaults text to the body role and a paragraph", () => {
    expect(render({ type: "text", value: "hi" })).toContain("<p");
  });

  it("renders a launcher icon from the allowlist and drops an unknown name", () => {
    expect(render({ type: "image", icon: "globe" })).toContain("<svg");
    expect(render({ type: "image", icon: "notAnIcon" })).toBe("");
  });

  it("renders a package image as a decorative img with its fit", () => {
    const html = render({ type: "image", src: "images/logo.png", fit: "contain" }, { themeId: "aurora.theme" });
    expect(html).toContain('alt=""');
    expect(html).toContain("object-fit:contain");
    expect(html).toContain("tetra-theme://aurora.theme/images/logo.png");
  });

  it("renders an outlet's content from the outlets map", () => {
    const html = render(
      { type: "outlet", name: "view" },
      { outlets: { view: <span>the view</span> } },
    );
    expect(html).toBe("<span>the view</span>");
  });

  it("renders nothing for an outlet with no content", () => {
    expect(render({ type: "outlet", name: "modals" })).toBe("");
  });
});

describe("host nodes", () => {
  it("delegates element and surface leaves to renderElement", () => {
    const html = render(
      {
        type: "stack",
        children: [{ element: "server.join" }, { surface: "surface.navRail" }],
      },
      {
        renderElement: (node) => <b>{node.element ?? node.surface}</b>,
      },
    );
    expect(html).toContain("<b>server.join</b>");
    expect(html).toContain("<b>surface.navRail</b>");
  });
});

describe("sizing and positioning", () => {
  it("resolves sizing props, including space tokens and flex behaviour", () => {
    const html = render({
      type: "box",
      width: "50%",
      minWidth: "space.24",
      grow: 1,
      shrink: 0,
      basis: "160px",
      children: [],
    });
    expect(html).toContain("width:50%");
    expect(html).toContain("min-width:var(--t-space-24)");
    expect(html).toContain("flex-grow:1");
    expect(html).toContain("flex-shrink:0");
    expect(html).toContain("flex-basis:160px");
  });

  it("resolves padding tokens onto every edge", () => {
    const html = render({ type: "box", paddingX: "space.8", paddingTop: "rowY", children: [] });
    expect(html).toContain("padding-left:var(--t-space-8)");
    expect(html).toContain("padding-right:var(--t-space-8)");
    expect(html).toContain("padding-top:var(--t-space-rowY)");
  });

  it("anchors a corner-positioned node with its offsets", () => {
    const html = render({
      type: "box",
      position: { anchor: "topRight", x: "8px", y: "8px" },
      children: [],
    });
    expect(html).toContain("position:absolute");
    expect(html).toContain("top:8px");
    expect(html).toContain("right:8px");
  });

  it("centres a centre-anchored node with a transform", () => {
    const html = render({ type: "box", position: { anchor: "center" }, children: [] });
    expect(html).toContain("top:50%");
    expect(html).toContain("left:50%");
    expect(html).toContain("translateY(-50%)");
    expect(html).toContain("translateX(-50%)");
  });

  it("makes a container the containing block for its anchored children", () => {
    const html = render({
      type: "box",
      children: [{ type: "box", position: { anchor: "bottomLeft" }, children: [] }],
    });
    expect(html).toContain("position:relative");
  });
});

describe("landmarks", () => {
  it("maps each landmark to its element tag", () => {
    expect(render({ type: "stack", landmark: "navigation", children: [] })).toContain("<nav");
    expect(render({ type: "box", landmark: "main", children: [] })).toContain("<main");
    expect(render({ type: "box", landmark: "complementary", children: [] })).toContain("<aside");
    expect(render({ type: "stack", landmark: "banner", children: [] })).toContain("<header");
    expect(render({ type: "stack", landmark: "contentinfo", children: [] })).toContain("<footer");
  });
});

describe("region id and theme classes", () => {
  it("carries the region id and theme classes through", () => {
    const html = render({ type: "box", id: "r-detail", class: "t-panel t-elevated", children: [] });
    expect(html).toContain('id="r-detail"');
    expect(html).toContain('class="t-panel t-elevated"');
  });
});

describe("hidden conditions", () => {
  const tree = (hidden: LayoutNode["hidden"]): LayoutNode => ({
    type: "stack",
    children: [{ type: "text", value: "gone", hidden }, { type: "text", value: "kept" }],
  });

  it("hides a node with hidden:true", () => {
    const html = render(tree(true));
    expect(html).not.toContain("gone");
    expect(html).toContain("kept");
  });

  it("hides on an equals match and shows otherwise", () => {
    expect(render(tree({ setting: "compactRows", equals: true }), { settings: { compactRows: true } })).not.toContain("gone");
    expect(render(tree({ setting: "compactRows", equals: true }), { settings: { compactRows: false } })).toContain("gone");
  });

  it("hides on a not-match", () => {
    expect(render(tree({ setting: "mode", not: "grid" }), { settings: { mode: "list" } })).not.toContain("gone");
    expect(render(tree({ setting: "mode", not: "grid" }), { settings: { mode: "grid" } })).toContain("gone");
  });
});

describe("viewport width", () => {
  const variants: LayoutFile = {
    schemaVersion: 2,
    variants: [
      { minWidth: 0, root: { type: "box", id: "r-narrow", children: [] } },
      { minWidth: 1400, root: { type: "box", id: "r-wide", children: [] } },
    ],
  };
  const html = (props: { width?: number } = {}) =>
    renderToStaticMarkup(<LayoutRenderer file={variants} {...props} />);

  afterEach(() => vi.unstubAllGlobals());

  it("picks the variant for the measured viewport when no width prop is given", () => {
    vi.stubGlobal("window", { innerWidth: 975 });
    expect(html()).toContain('id="r-narrow"');

    vi.stubGlobal("window", { innerWidth: 1400 });
    expect(html()).toContain('id="r-wide"');
  });

  it("reads no viewport without a window, and still renders the first variant", () => {
    expect(html()).toContain('id="r-narrow"');
  });

  it("prefers an explicit width prop over the viewport", () => {
    vi.stubGlobal("window", { innerWidth: 1400 });
    expect(html({ width: 975 })).toContain('id="r-narrow"');
  });

  it("prefers a dev variantWidth over both", () => {
    vi.stubGlobal("window", { innerWidth: 975 });
    useDevStore.getState().setVariantWidth(1400);
    expect(html({ width: 975 })).toContain('id="r-wide"');
  });
});

describe("dev-mode overrides", () => {
  const variants: LayoutFile = {
    schemaVersion: 2,
    variants: [
      { minWidth: 0, root: { type: "box", id: "r-narrow", children: [] } },
      { minWidth: 900, root: { type: "box", id: "r-wide", children: [] } },
    ],
  };

  it("picks the variant for a dev variantWidth over the width prop", () => {
    useDevStore.getState().setVariantWidth(1000);
    const html = renderToStaticMarkup(<LayoutRenderer file={variants} width={500} />);
    expect(html).toContain('id="r-wide"');
  });

  it("reads a dev settingsOverride for a node's hidden condition", () => {
    useDevStore.getState().setSettingsOverride({ compactRows: true });
    const html = render(
      { type: "stack", children: [{ type: "text", value: "gone", hidden: { setting: "compactRows", equals: true } }, { type: "text", value: "kept" }] },
      { settings: { compactRows: false } },
    );
    expect(html).not.toContain("gone");
  });

  it("leaves the existing width/settings behaviour unchanged when both dev overrides are null", () => {
    expect(resolveVariant(variants, 899)).toEqual(
      expect.objectContaining({ id: "r-narrow" }),
    );
    const html = render(tree({ setting: "compactRows", equals: true }), { settings: { compactRows: true } });
    expect(html).not.toContain("gone");
  });
});

function tree(hidden: LayoutNode["hidden"]): LayoutNode {
  return {
    type: "stack",
    children: [{ type: "text", value: "gone", hidden }, { type: "text", value: "kept" }],
  };
}
