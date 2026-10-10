import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isElementInLayout } from "../layout-query";
import { LayoutRenderer } from "../renderer/layout-renderer";
import { BROWSER_LAYOUT } from "./browser";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral browser view", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("view:browser", BROWSER_LAYOUT);
  });

  it("places the launch notice", () => {
    expect(isElementInLayout(BROWSER_LAYOUT, "notice.launch")).toBe(true);
  });

  it("renders browser view without throwing", () => {
    const html = renderToStaticMarkup(createElement(LayoutRenderer, { file: BROWSER_LAYOUT }));
    expect(html).toContain('data-el="filter.search"');
    expect(html).toContain('data-el="list.servers"');
  });
});
