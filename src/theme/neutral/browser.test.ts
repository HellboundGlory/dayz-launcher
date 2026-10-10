import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "../elements/context";
import { isElementInLayout } from "../layout-query";
import { LayoutRenderer } from "../renderer/layout-renderer";
import { BROWSER_LAYOUT } from "./browser";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral browser view", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("view:browser", BROWSER_LAYOUT);
  });

  it("browser view contains view:browser required elements and selection panel withJoin", () => {
    expect(isElementInLayout(BROWSER_LAYOUT, "filter.search")).toBe(true);
    expect(isElementInLayout(BROWSER_LAYOUT, "servers.refresh")).toBe(true);
    expect(isElementInLayout(BROWSER_LAYOUT, "list.servers")).toBe(true);
    expect(isElementInLayout(BROWSER_LAYOUT, "server.join")).toBe(true);
    expect(isElementInLayout(BROWSER_LAYOUT, "server.actionNotice")).toBe(true);
  });

  it("renders browser view without throwing", () => {
    const mockServer = {
      name: "Test Server #1",
      address: "127.0.0.1:2302",
      players: 42,
      maxPlayers: 60,
      ping: 25,
      map: "Chernarus",
    };

    const html = renderToStaticMarkup(
      createElement(
        ElementContextProvider,
        { value: { selectedServer: mockServer as never } },
        createElement(LayoutRenderer, { file: BROWSER_LAYOUT }),
      ),
    );
    expect(html).toContain('data-surface="surface.filterBar"');
    expect(html).toContain('data-el="list.servers"');
    expect(html).toContain('id="r-detail"');
    expect(html).toContain("Test Server #1");
    expect(html).toContain('data-el="server.join"');
  });
});
