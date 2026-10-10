import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { REGISTRY } from "../registry";
import type { LayoutNode } from "../renderer/types";
import { LayoutRenderer } from "../renderer/layout-renderer";
import { ModalHost } from "../interaction/modal-host";
import { ListRow } from "../lists/list-row";
import { ElementContextProvider } from "../elements/context";
import {
  BROWSER_LAYOUT,
  MOD_FILTER_MODAL,
  MOD_FILTER_RESULTS_LIST,
  MODS_LIST,
  NEUTRAL_LAYOUTS,
  SERVER_INFO_MODAL,
  SERVERS_LIST,
  SHELL_LAYOUT,
  UPDATE_MODAL,
  getNeutralLayout,
} from "./index";

describe("Neutral layouts", () => {
  describe("getNeutralLayout lookup", () => {
    it("resolves full paths and short relative names", () => {
      expect(getNeutralLayout("layout/shell.json")).toBe(SHELL_LAYOUT);
      expect(getNeutralLayout("shell.json")).toBe(SHELL_LAYOUT);
      expect(getNeutralLayout("layout/views/browser.json")).toBe(BROWSER_LAYOUT);
      expect(getNeutralLayout("views/browser.json")).toBe(BROWSER_LAYOUT);
      expect(getNeutralLayout("unknown.json")).toBeUndefined();
    });

    it("registers all 13 compiled-in layout files", () => {
      const keys = Object.keys(NEUTRAL_LAYOUTS);
      expect(keys).toHaveLength(13);
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
    });
  });

  describe("Schema and structural validation", () => {
    it("all layouts specify schemaVersion 2", () => {
      for (const layout of Object.values(NEUTRAL_LAYOUTS)) {
        expect(layout.schemaVersion).toBe(2);
      }
    });

    it("modal files specify center placement and dim backdrop", () => {
      const modals = [SERVER_INFO_MODAL, UPDATE_MODAL, MOD_FILTER_MODAL];
      for (const modal of modals) {
        expect(modal.placement?.mode).toBe("center");
        expect(modal.backdrop).toBe("dim");
        expect(modal.root).toBeDefined();
      }
    });
  });

  describe("Registered id coverage", () => {
    // Walks every node reachable from a layout file and asserts each `element`/`surface`
    // id is known to the registry. This catches unknown ids (the drift that actually
    // happened); it does not replace the Rust validator's full structural checks.
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

    it("every element/surface id used by Neutral's layouts is registered", () => {
      const violations: string[] = [];
      for (const [file, layout] of Object.entries(NEUTRAL_LAYOUTS)) {
        if (layout.root) collectUnknownIds(layout.root, file, violations);
        for (const variant of layout.variants ?? []) collectUnknownIds(variant.root, file, violations);
        if (layout.row) collectUnknownIds(layout.row, file, violations);
      }
      expect(violations).toEqual([]);
    });
  });

  describe("Pure React SSR rendering", () => {
    it("renders all modals with ModalHost without throwing", () => {
      const mockServer = {
        name: "DayZ Server",
        address: "127.0.0.1:2302",
        players: 10,
        maxPlayers: 60,
        ping: 30,
        map: "Chernarus",
      };

      const serverInfoHtml = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          { value: { selectedServer: mockServer as never } },
          createElement(ModalHost, { file: SERVER_INFO_MODAL, onClose: () => {} }),
        ),
      );
      expect(serverInfoHtml).toContain('data-modal-host=""');
      expect(serverInfoHtml).toContain('data-backdrop="dim"');
      expect(serverInfoHtml).toContain('data-placement="center"');
      expect(serverInfoHtml).toContain('data-el="modal.close"');
      expect(serverInfoHtml).toContain('data-el="server.join"');

      const updateHtml = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(ModalHost, { file: UPDATE_MODAL, onClose: () => {} }),
        ),
      );
      expect(updateHtml).toContain("Updates");
      expect(updateHtml).toContain('data-el="update.viewRelease"');

      const modFilterHtml = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(ModalHost, { file: MOD_FILTER_MODAL, onClose: () => {} }),
        ),
      );
      expect(modFilterHtml).toContain("Filter by Mod");
      expect(modFilterHtml).toContain('data-el="modFilter.apply"');
      expect(modFilterHtml).toContain('data-el="list.modFilterResults"');
    });

    it("renders list row templates with ListRow without throwing", () => {
      const serverRowHtml = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(ListRow, {
            rowNode: SERVERS_LIST.row,
            columns: SERVERS_LIST.columns,
            item: { name: "Official US - NY 1234", ping: 45, map: "Livonia" },
            subjectKind: "server",
          }),
        ),
      );
      expect(serverRowHtml).toContain('data-row=""');
      expect(serverRowHtml).toContain('data-el="server.name"');
      expect(serverRowHtml).toContain('data-el="server.join"');

      const modRowHtml = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(ListRow, {
            rowNode: MODS_LIST.row,
            columns: MODS_LIST.columns,
            item: { name: "DayZ-Expansion", status: "Ready", size: 1048576 },
            subjectKind: "mod",
          }),
        ),
      );
      expect(modRowHtml).toContain('data-row=""');
      expect(modRowHtml).toContain('data-el="mod.name"');
      expect(modRowHtml).toContain('data-el="mod.status"');

      const modFilterRowHtml = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(ListRow, {
            rowNode: MOD_FILTER_RESULTS_LIST.row,
            item: { id: 123456, name: "TraderPlus" },
            subjectKind: "workshopMod",
          }),
        ),
      );
      expect(modFilterRowHtml).toContain('data-row=""');
      expect(modFilterRowHtml).toContain('data-el="workshopMod.pick"');
    });

    it("renders every compiled-in Neutral layout without throwing", () => {
      for (const [name, layout] of Object.entries(NEUTRAL_LAYOUTS)) {
        if (layout.root) {
          const html = renderToStaticMarkup(
            createElement(
              ElementContextProvider,
              null,
              createElement(LayoutRenderer, { file: layout }),
            ),
          );
          expect(html.length, `Layout ${name} should produce non-empty markup`).toBeGreaterThan(0);
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
          expect(html.length, `List template ${name} should produce non-empty markup`).toBeGreaterThan(0);
        }
      }
    });
  });
});
