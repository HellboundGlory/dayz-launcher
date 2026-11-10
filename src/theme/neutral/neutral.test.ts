import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementContextProvider } from "../elements/context";
import { isElementInLayout } from "../layout-query";
import { REGISTRY } from "../registry";
import { LayoutRenderer } from "../renderer/layout-renderer";
import type { LayoutFile, LayoutNode } from "../renderer/types";
import { ListRow } from "../lists/list-row";
import {
  BROWSER_LAYOUT,
  MOD_FILTER_MODAL,
  MOD_FILTER_RESULTS_LIST,
  MODS_LAYOUT,
  MODS_LIST,
  NEUTRAL_LAYOUTS,
  SERVER_INFO_MODAL,
  SERVERS_LIST,
  SETTINGS_LAYOUT,
  SHELL_LAYOUT,
  UPDATE_MODAL,
  getNeutralLayout,
} from "./index";
import { expectRequiredPlaced } from "./test-helpers";

const PLACED: { context: string; layout: LayoutFile }[] = [
  { context: "view:browser", layout: BROWSER_LAYOUT },
  { context: "view:mods", layout: MODS_LAYOUT },
  { context: "settings", layout: SETTINGS_LAYOUT },
  { context: "modal:serverInfo", layout: SERVER_INFO_MODAL },
  { context: "modal:update", layout: UPDATE_MODAL },
  { context: "modal:modFilter", layout: MOD_FILTER_MODAL },
  { context: "list:servers/row", layout: SERVERS_LIST },
  { context: "list:mods/row", layout: MODS_LIST },
  { context: "list:modFilterResults/row", layout: MOD_FILTER_RESULTS_LIST },
];

describe("Neutral layouts", () => {
  it.each(PLACED)("$context places every element it requires", ({ context, layout }) => {
    expectRequiredPlaced(context, layout);
  });

  it("leaves the browser notices to the toast host", () => {
    for (const id of ["notice.launch", "notice.storage", "notice.error"]) {
      expect(isElementInLayout(BROWSER_LAYOUT, id), id).toBe(false);
    }
  });

  describe("getNeutralLayout lookup", () => {
    it("resolves full paths and short relative names", () => {
      expect(getNeutralLayout("layout/shell.json")).toBe(SHELL_LAYOUT);
      expect(getNeutralLayout("shell.json")).toBe(SHELL_LAYOUT);
      expect(getNeutralLayout("layout/views/browser.json")).toBe(BROWSER_LAYOUT);
      expect(getNeutralLayout("views/browser.json")).toBe(BROWSER_LAYOUT);
      expect(getNeutralLayout("unknown.json")).toBeUndefined();
    });

    it("registers all 14 compiled-in layout files", () => {
      const keys = Object.keys(NEUTRAL_LAYOUTS);
      expect(keys).toHaveLength(14);
      expect(keys).toContain("layout/shell.json");
      expect(keys).toContain("layout/views/browser.json");
      expect(keys).toContain("layout/views/mods.json");
      expect(keys).toContain("layout/settings.json");
      expect(keys).toContain("layout/modals/serverInfo.json");
      expect(keys).toContain("layout/modals/update.json");
      expect(keys).toContain("layout/modals/modFilter.json");
      expect(keys).toContain("layout/lists/servers.json");
      expect(keys).toContain("layout/lists/mods.json");
      expect(keys).toContain("layout/lists/modFilterResults.json");
      expect(keys).toContain("layout/lists/modServers.json");
      expect(keys).toContain("layout/lists/serverMods.json");
      expect(keys).toContain("layout/popups/serverRow.json");
    });
  });

  it.each(Object.entries(NEUTRAL_LAYOUTS))("renders %s without throwing", (_file, layout) => {
    if (layout.root) {
      const html = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(LayoutRenderer, { file: layout }),
        ),
      );
      expect(html.length).toBeGreaterThan(0);
    } else if (layout.row) {
      const html = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(ListRow, {
            rowNode: layout.row,
            columns: layout.columns,
            item: { name: "Item" },
            subjectKind: "server",
          }),
        ),
      );
      expect(html.length).toBeGreaterThan(0);
    } else {
      throw new Error(`${_file} has no root or row`);
    }
  });

  it("every element/surface id used by Neutral's layouts is registered", () => {
    function collectUnknownIds(node: LayoutNode, file: string, violations: string[]): void {
      if ("element" in node && node.element) {
        if (!(node.element in REGISTRY.elements)) {
          violations.push(`${file}: unknown element "${node.element}"`);
        }
      }
      if ("surface" in node && node.surface) {
        if (!(node.surface in REGISTRY.surfaces)) {
          violations.push(`${file}: unknown surface "${node.surface}"`);
        }
      }
      if ("children" in node && node.children) {
        for (const child of node.children) collectUnknownIds(child, file, violations);
      }
      if ("tabs" in node && node.tabs) {
        for (const tab of node.tabs) {
          collectUnknownIds(tab.label, file, violations);
          collectUnknownIds(tab.content, file, violations);
        }
      }
      if ("sections" in node && node.sections) {
        for (const section of node.sections) {
          collectUnknownIds(section.header, file, violations);
          collectUnknownIds(section.body, file, violations);
        }
      }
      if (node.empty) collectUnknownIds(node.empty, file, violations);
      if (node.collapsible?.collapsed) collectUnknownIds(node.collapsible.collapsed, file, violations);
    }

    const violations: string[] = [];
    for (const [file, layout] of Object.entries(NEUTRAL_LAYOUTS)) {
      if (layout.root) collectUnknownIds(layout.root, file, violations);
      for (const variant of layout.variants ?? []) collectUnknownIds(variant.root, file, violations);
      if (layout.row) collectUnknownIds(layout.row, file, violations);
    }
    expect(violations).toEqual([]);
  });
});
