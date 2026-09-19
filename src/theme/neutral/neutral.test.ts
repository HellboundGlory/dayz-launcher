import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { REGISTRY } from "../registry";
import type { LayoutNode } from "../renderer/types";
import { LayoutRenderer } from "../renderer/layout-renderer";
import { ModalHost } from "../interaction/modal-host";
import { SettingsHost } from "../interaction/settings-host";
import { ListRow } from "../lists/list-row";
import { ElementContextProvider } from "../elements/context";
import { getMissingRequiredElements, isElementInLayout } from "../fallback/auto-placement";
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

describe("Neutral layouts", () => {
  describe("getNeutralLayout lookup", () => {
    it("resolves full paths and short relative names", () => {
      expect(getNeutralLayout("layout/shell.json")).toBe(SHELL_LAYOUT);
      expect(getNeutralLayout("shell.json")).toBe(SHELL_LAYOUT);
      expect(getNeutralLayout("layout/views/browser.json")).toBe(BROWSER_LAYOUT);
      expect(getNeutralLayout("views/browser.json")).toBe(BROWSER_LAYOUT);
      expect(getNeutralLayout("unknown.json")).toBeUndefined();
    });

    it("registers all 10 compiled-in layout files", () => {
      const keys = Object.keys(NEUTRAL_LAYOUTS);
      expect(keys).toHaveLength(10);
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
    });
  });

  describe("Required elements completeness", () => {
    it("shell contains all required elements for views and views+settings", () => {
      expect(getMissingRequiredElements(SHELL_LAYOUT, "views")).toEqual([]);
      expect(getMissingRequiredElements(SHELL_LAYOUT, "views+settings")).toEqual([]);
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

    it("browser view contains view:browser required elements and selection panel withJoin", () => {
      expect(getMissingRequiredElements(BROWSER_LAYOUT, "view:browser")).toEqual([]);
      expect(isElementInLayout(BROWSER_LAYOUT, "filter.search")).toBe(true);
      expect(isElementInLayout(BROWSER_LAYOUT, "servers.refresh")).toBe(true);
      expect(isElementInLayout(BROWSER_LAYOUT, "list.servers")).toBe(true);
      expect(isElementInLayout(BROWSER_LAYOUT, "server.join")).toBe(true);
      expect(isElementInLayout(BROWSER_LAYOUT, "server.actionNotice")).toBe(true);
    });

    it("mods view contains view:mods required elements and modSelection panel", () => {
      expect(getMissingRequiredElements(MODS_LAYOUT, "view:mods")).toEqual([]);
      expect(isElementInLayout(MODS_LAYOUT, "notice.modsError")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "notice.modsCached")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "notice.modsResult")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "list.mods")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.name")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.status")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.size")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.updated")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.subscribed")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.update")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.openInSteam")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.openFolder")).toBe(true);
      expect(isElementInLayout(MODS_LAYOUT, "mod.reinstall")).toBe(true);
    });

    it("settings layout contains all 16 required settings elements", () => {
      expect(getMissingRequiredElements(SETTINGS_LAYOUT, "settings")).toEqual([]);
      const settingsReqs = [
        "settings.back",
        "settings.themeManagement",
        "settings.profileName",
        "settings.dayzPath",
        "settings.detectPaths",
        "settings.workshopPath",
        "settings.launchParams",
        "settings.minimiseToTray",
        "settings.closeToTray",
        "settings.onJoin",
        "settings.startWithWindows",
        "settings.startMinimised",
        "settings.discordPresence",
        "settings.dataFolder",
        "settings.openDataFolder",
        "settings.autoRefresh",
      ];
      for (const id of settingsReqs) {
        expect(isElementInLayout(SETTINGS_LAYOUT, id)).toBe(true);
      }
    });

    it("serverInfo modal contains all modal:serverInfo required elements", () => {
      expect(getMissingRequiredElements(SERVER_INFO_MODAL, "modal:serverInfo")).toEqual([]);
      expect(isElementInLayout(SERVER_INFO_MODAL, "modal.close")).toBe(true);
      expect(isElementInLayout(SERVER_INFO_MODAL, "server.join")).toBe(true);
      expect(isElementInLayout(SERVER_INFO_MODAL, "server.actionNotice")).toBe(true);
    });

    it("update modal contains all modal:update required elements", () => {
      expect(getMissingRequiredElements(UPDATE_MODAL, "modal:update")).toEqual([]);
      expect(isElementInLayout(UPDATE_MODAL, "modal.close")).toBe(true);
      expect(isElementInLayout(UPDATE_MODAL, "update.install")).toBe(true);
      expect(isElementInLayout(UPDATE_MODAL, "update.viewRelease")).toBe(true);
    });

    it("modFilter modal contains all modal:modFilter required elements", () => {
      expect(getMissingRequiredElements(MOD_FILTER_MODAL, "modal:modFilter")).toEqual([]);
      expect(isElementInLayout(MOD_FILTER_MODAL, "modal.close")).toBe(true);
      expect(isElementInLayout(MOD_FILTER_MODAL, "modFilter.apply")).toBe(true);
      expect(isElementInLayout(MOD_FILTER_MODAL, "list.modFilterResults")).toBe(true);
    });

    it("servers list row contains list:servers/row required elements and withJoin notice", () => {
      expect(getMissingRequiredElements(SERVERS_LIST, "list:servers/row")).toEqual([]);
      expect(isElementInLayout(SERVERS_LIST, "server.join")).toBe(true);
      expect(isElementInLayout(SERVERS_LIST, "server.actionNotice")).toBe(true);
    });

    it("mods list row contains list:mods/row required elements", () => {
      expect(getMissingRequiredElements(MODS_LIST, "list:mods/row")).toEqual([]);
      expect(isElementInLayout(MODS_LIST, "mod.select")).toBe(true);
      expect(isElementInLayout(MODS_LIST, "mod.status")).toBe(true);
    });

    it("modFilterResults list row contains list:modFilterResults/row required elements", () => {
      expect(getMissingRequiredElements(MOD_FILTER_RESULTS_LIST, "list:modFilterResults/row")).toEqual([]);
      expect(isElementInLayout(MOD_FILTER_RESULTS_LIST, "workshopMod.pick")).toBe(true);
    });
  });

  describe("Schema and structural validation", () => {
    it("all layouts specify schemaVersion 2", () => {
      for (const layout of Object.values(NEUTRAL_LAYOUTS)) {
        expect(layout.schemaVersion).toBe(2);
      }
    });

    it("shell landmark box defines region r-main matching settings overlay presentation", () => {
      expect(SHELL_LAYOUT.root && "type" in SHELL_LAYOUT.root ? SHELL_LAYOUT.root.type : undefined).toBe("stack");
      const shellChildren = (SHELL_LAYOUT.root && "children" in SHELL_LAYOUT.root)
        ? SHELL_LAYOUT.root.children
        : [];
      const mainBox = shellChildren.find((c) => c.id === "r-main");
      expect(mainBox).toBeDefined();
      expect(mainBox?.landmark).toBe("main");
      expect(SETTINGS_LAYOUT.presentation).toEqual({ mode: "overlay", region: "r-main" });
    });

    it("modal files specify center placement and dim backdrop", () => {
      const modals = [SERVER_INFO_MODAL, UPDATE_MODAL, MOD_FILTER_MODAL];
      for (const modal of modals) {
        expect(modal.placement?.mode).toBe("center");
        expect(modal.backdrop).toBe("dim");
        expect(modal.root).toBeDefined();
      }
    });

    it("servers list matches declared columns and valid sort keys", () => {
      expect(SERVERS_LIST.columns).toBeDefined();
      const colIds = SERVERS_LIST.columns?.map((c) => c.id);
      expect(colIds).toEqual(["favourite", "name", "players", "map", "ping", "actions"]);

      const allowedSorts = REGISTRY.lists["list.servers"].sortKeys;
      for (const col of SERVERS_LIST.columns ?? []) {
        if (col.sort) {
          expect(allowedSorts).toContain(col.sort);
        }
      }
    });

    it("mods list matches declared columns and valid sort keys", () => {
      expect(MODS_LIST.columns).toBeDefined();
      const colIds = MODS_LIST.columns?.map((c) => c.id);
      expect(colIds).toEqual(["name", "status", "size", "updated"]);

      const allowedSorts = REGISTRY.lists["list.mods"].sortKeys;
      for (const col of MODS_LIST.columns ?? []) {
        if (col.sort) {
          expect(allowedSorts).toContain(col.sort);
        }
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
      expect(html).toContain('data-surface="surface.navRail"');
      expect(html).toContain('data-surface="surface.windowControls"');
      expect(html).toContain('data-el="notice.storage"');
      expect(html).toContain('data-el="notice.error"');
      expect(html).toContain('id="r-main"');
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

    it("renders mods view without throwing", () => {
      const mockMod = {
        name: "Community Framework",
        status: "Ready",
        size: 5242880,
        updated: "2026-09-18",
        author: "CF Team",
        subscribed: true,
      };

      const html = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          { value: { selectedMod: mockMod } },
          createElement(LayoutRenderer, { file: MODS_LAYOUT }),
        ),
      );
      expect(html).toContain('data-el="list.mods"');
      expect(html).toContain("Community Framework");
      expect(html).toContain('data-el="mod.status"');
    });

    it("renders settings layout with accordion and overlay presentation", () => {
      const html = renderToStaticMarkup(
        createElement(
          ElementContextProvider,
          null,
          createElement(SettingsHost, { file: SETTINGS_LAYOUT }),
        ),
      );
      expect(html).toContain('data-settings-host=""');
      expect(html).toContain('data-presentation="overlay"');
      expect(html).toContain('data-region="r-main"');
      expect(html).toContain('data-el="settings.back"');
      expect(html).toContain('data-accordion="r-settings"');
      expect(html).toContain("Game");
      expect(html).toContain("Launcher");
      expect(html).toContain("Theme");
    });

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
      expect(updateHtml).toContain("Update Available");
      expect(updateHtml).toContain('data-el="update.install"');

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
