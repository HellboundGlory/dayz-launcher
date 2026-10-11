import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "../elements/context";
import { resolveRequiredElements } from "../fallback/use-visibility-check";
import { isElementInLayout } from "../layout-query";
import { LayoutRenderer } from "../renderer/layout-renderer";
import type { LayoutNode } from "../renderer/types";
import { BROWSER_LAYOUT } from "./browser";
import { SETTINGS_LAYOUT } from "./settings";
import { SHELL_LAYOUT } from "./shell";

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

// The shell and Neutral's browser view are both Neutral's, so together they place what a context requires.
function placed(id: string): boolean {
  return isElementInLayout(SHELL_LAYOUT, id) || isElementInLayout(BROWSER_LAYOUT, id);
}

describe("Neutral shell layout", () => {
  it.each(["views", "views+settings"])("%s: the shell and the browser view place every element it requires", (context) => {
    const required = [...resolveRequiredElements([context]).keys()];
    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((id) => !placed(id))).toEqual([]);
  });

  it("shell landmark box defines region r-main matching settings overlay presentation", () => {
    expect(childrenOf(findNode(SHELL_LAYOUT.root, "r-main")).some((node) => node.landmark === "main")).toBe(true);
    expect(SETTINGS_LAYOUT.presentation).toEqual({ mode: "overlay", region: "r-main" });
  });

  it("renders shell without throwing", () => {
    const html = renderToStaticMarkup(
      createElement(
        ElementContextProvider,
        { value: {} },
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
    expect(html).toContain('id="r-main"');
  });
});
