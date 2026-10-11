import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "../elements/context";
import { isElementInLayout } from "../layout-query";
import { LayoutRenderer } from "../renderer/layout-renderer";
import type { LayoutNode } from "../renderer/types";
import { SETTINGS_LAYOUT } from "./settings";
import { SHELL_LAYOUT } from "./shell";
import { expectRequiredPlaced } from "./test-helpers";

function childrenOf(node: LayoutNode | undefined): LayoutNode[] {
  return node && "children" in node ? node.children : [];
}

function findNode(node: LayoutNode | undefined, id: string): LayoutNode | undefined {
  if (node?.id === id) return node;
  for (const child of childrenOf(node)) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("Neutral shell layout", () => {
  it.each(["views", "views+settings"])("%s places every element it requires", (context) => {
    expectRequiredPlaced(context, SHELL_LAYOUT);
  });

  it("shell contains all required elements for views and views+settings", () => {
    expect(isElementInLayout(SHELL_LAYOUT, "app.minimize")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "app.maximize")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "app.close")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "app.dragRegion")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "nav.servers")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "nav.favourites")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "nav.recent")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "nav.mods")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "nav.settings")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "status.steam")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "notice.storage")).toBe(true);
    expect(isElementInLayout(SHELL_LAYOUT, "notice.error")).toBe(true);
  });

  it("shell landmark box defines region r-main matching settings overlay presentation", () => {
    expect(findNode(SHELL_LAYOUT.root, "r-main")?.landmark).toBe("main");
    expect(SETTINGS_LAYOUT.presentation).toEqual({ mode: "overlay", region: "r-main" });
  });

  it("renders shell without throwing", () => {
    const html = renderToStaticMarkup(
      createElement(
        ElementContextProvider,
        { value: { storageDegraded: true, error: "Disk error" } },
        createElement(LayoutRenderer, {
          file: SHELL_LAYOUT,
          outlets: {
            view: createElement("div", { id: "test-view" }, "Active View"),
            modals: createElement("div", { id: "test-modals" }, "Active Modals"),
          },
        }),
      ),
    );
    expect(html).toContain("Active View");
    expect(html).toContain("Active Modals");
    expect(html).toContain('id="r-sidebar"');
    expect(html).toContain('data-surface="surface.windowControls"');
    expect(html).toContain('data-el="notice.storage"');
    expect(html).toContain('data-el="notice.error"');
    expect(html).toContain('id="r-main"');
  });
});
