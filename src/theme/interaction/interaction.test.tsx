import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LayoutRenderer } from "../renderer/layout-renderer";
import type { LayoutFile, LayoutNode } from "../renderer/types";
import { ElementContextProvider, type ElementContextValue } from "../elements/context";
import {
  clearInteractionMemory,
  clearThemeInteraction,
  getPersistedAccordion,
  getPersistedCollapsed,
  getPersistedSize,
  getPersistedTab,
  setPersistedAccordion,
  setPersistedCollapsed,
  setPersistedSize,
  setPersistedTab,
} from "./store";
import { handleResizeKey, parseLengthPx, ResizableHandle } from "./resizable";
import { ModalHost } from "./modal-host";
import { PopupHost } from "./popup-host";
import { SettingsHost, SettingsRegionPortal } from "./settings-host";


const file = (root: LayoutNode): LayoutFile => ({ schemaVersion: 2, root });

const renderLayout = (
  root: LayoutNode,
  options: {
    themeId?: string;
    elementCtx?: Partial<ElementContextValue>;
  } = {},
) => {
  return renderToStaticMarkup(
    <ElementContextProvider value={options.elementCtx}>
      <LayoutRenderer file={file(root)} themeId={options.themeId ?? "test-theme"} />
    </ElementContextProvider>,
  );
};

describe("Theme Interaction & Presentation (Package 4.4)", () => {
  beforeEach(() => {
    clearInteractionMemory();
  });

  describe("Persisted State Store", () => {
    it("persists and retrieves active tab per theme", () => {
      expect(getPersistedTab("t1", "detail", "info")).toBe("info");
      setPersistedTab("t1", "detail", "mods");
      expect(getPersistedTab("t1", "detail", "info")).toBe("mods");
      expect(getPersistedTab("t2", "detail", "info")).toBe("info");
    });

    it("persists and retrieves open accordion sections per theme", () => {
      expect(getPersistedAccordion("t1", "settings", "none")).toEqual([]);
      expect(getPersistedAccordion("t1", "settings", "first", "game")).toEqual(["game"]);

      setPersistedAccordion("t1", "settings", ["launcher", "theme"]);
      expect(getPersistedAccordion("t1", "settings", "none")).toEqual(["launcher", "theme"]);
      expect(getPersistedAccordion("t2", "settings", "none")).toEqual([]);
    });

    it("persists and retrieves collapsed state per theme", () => {
      expect(getPersistedCollapsed("t1", "r-rail", false)).toBe(false);
      setPersistedCollapsed("t1", "r-rail", true);
      expect(getPersistedCollapsed("t1", "r-rail", false)).toBe(true);
      expect(getPersistedCollapsed("t2", "r-rail", false)).toBe(false);
    });

    it("persists and retrieves region size per theme", () => {
      expect(getPersistedSize("t1", "r-rail")).toBeUndefined();
      setPersistedSize("t1", "r-rail", "320px");
      expect(getPersistedSize("t1", "r-rail")).toBe("320px");
      expect(getPersistedSize("t2", "r-rail")).toBeUndefined();
    });

    it("clears interaction state for a specific theme", () => {
      setPersistedTab("t1", "tabs1", "a");
      setPersistedCollapsed("t1", "reg1", true);
      setPersistedTab("t2", "tabs1", "b");

      clearThemeInteraction("t1");
      expect(getPersistedTab("t1", "tabs1", "default")).toBe("default");
      expect(getPersistedCollapsed("t1", "reg1", false)).toBe(false);
      expect(getPersistedTab("t2", "tabs1", "default")).toBe("b");
    });
  });

  describe("Tabs Component", () => {
    const tabsNode: LayoutNode = {
      type: "tabs",
      id: "r-detail",
      tabs: [
        {
          id: "info",
          label: { type: "text", value: "Information", role: "label" },
          content: { type: "text", value: "Server Info Content" },
        },
        {
          id: "mods",
          label: { type: "text", value: "Mods List", role: "label" },
          content: { type: "text", value: "Mods Content" },
        },
      ],
    };

    it("renders tablist and tab buttons with ARIA attributes", () => {
      const html = renderLayout(tabsNode, { themeId: "theme-a" });

      expect(html).toContain('data-tabs="r-detail"');
      expect(html).toContain('role="tablist"');
      expect(html).toContain('aria-orientation="horizontal"');

      expect(html).toContain('id="r-detail-tab-info"');
      expect(html).toContain('role="tab"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('aria-controls="r-detail-panel-info"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain("Information");

      expect(html).toContain('id="r-detail-tab-mods"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain('aria-controls="r-detail-panel-mods"');
      expect(html).toContain('tabindex="-1"');
      expect(html).toContain("Mods List");

      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('id="r-detail-panel-info"');
      expect(html).toContain('aria-labelledby="r-detail-tab-info"');
      expect(html).toContain("Server Info Content");
      expect(html).not.toContain("Mods Content");
    });

    it("respects persisted active tab", () => {
      setPersistedTab("theme-a", "r-detail", "mods");
      const html = renderLayout(tabsNode, { themeId: "theme-a" });

      expect(html).toContain('id="r-detail-tab-mods"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('id="r-detail-tab-info"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain("Mods Content");
      expect(html).not.toContain("Server Info Content");
    });
  });

  describe("Accordion Component", () => {
    const accordionNode = (
      mode: "single" | "multiple",
      initial: "none" | "first",
    ): LayoutNode => ({
      type: "accordion",
      id: "r-settings",
      mode,
      initial,
      sections: [
        {
          id: "game",
          header: { type: "text", value: "Game Settings", role: "label" },
          body: { type: "text", value: "Game Settings Body" },
        },
        {
          id: "launcher",
          header: { type: "text", value: "Launcher Settings", role: "label" },
          body: { type: "text", value: "Launcher Settings Body" },
        },
      ],
    });

    it("renders sections with initial: 'none' (all closed)", () => {
      const html = renderLayout(accordionNode("single", "none"), { themeId: "acc-theme" });

      expect(html).toContain('data-accordion="r-settings"');
      expect(html).toContain('data-mode="single"');

      expect(html).toContain('data-section="game"');
      expect(html).toContain('data-state="closed"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-controls="r-settings-body-game"');

      expect(html).toContain('data-section="launcher"');
      expect(html).toContain('data-state="closed"');
      expect(html).toContain('aria-expanded="false"');

      expect(html).not.toContain("Game Settings Body");
      expect(html).not.toContain("Launcher Settings Body");
    });

    it("renders sections with initial: 'first' (first open)", () => {
      const html = renderLayout(accordionNode("single", "first"), { themeId: "acc-theme" });

      expect(html).toContain('data-section="game" data-state="open"');
      expect(html).toContain('id="r-settings-header-game"');
      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain('id="r-settings-body-game"');
      expect(html).toContain("Game Settings Body");

      expect(html).toContain('data-section="launcher" data-state="closed"');
      expect(html).toContain('id="r-settings-header-launcher"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toContain("Launcher Settings Body");
    });

    it("respects persisted open sections in multiple mode", () => {
      setPersistedAccordion("acc-theme", "r-settings", ["game", "launcher"]);
      const html = renderLayout(accordionNode("multiple", "none"), { themeId: "acc-theme" });

      expect(html).toContain('data-section="game" data-state="open"');
      expect(html).toContain('data-section="launcher" data-state="open"');
      expect(html).toContain("Game Settings Body");
      expect(html).toContain("Launcher Settings Body");
    });
  });

  describe("Collapsible Region", () => {
    const collapsibleStack: LayoutNode = {
      type: "stack",
      id: "r-rail",
      collapsible: {
        default: "expanded",
        collapsed: {
          type: "box",
          id: "r-rail-collapsed",
          children: [{ type: "text", value: "Mini Rail" }],
        },
      },
      children: [{ type: "text", value: "Full Rail Content" }],
    };

    it("renders expanded subtree and data-state='expanded' by default", () => {
      const html = renderLayout(collapsibleStack, { themeId: "col-theme" });

      expect(html).toContain('id="r-rail"');
      expect(html).toContain('data-state="expanded"');
      expect(html).toContain("Full Rail Content");
      expect(html).not.toContain("Mini Rail");
    });

    it("renders collapsed subtree and data-state='collapsed' when collapsed in context", () => {
      const html = renderLayout(collapsibleStack, {
        themeId: "col-theme",
        elementCtx: { collapsedRegions: { "r-rail": true } },
      });

      expect(html).toContain('id="r-rail"');
      expect(html).toContain('data-state="collapsed"');
      expect(html).toContain("Mini Rail");
      expect(html).not.toContain("Full Rail Content");
    });

    it("respects persisted collapsed state", () => {
      setPersistedCollapsed("col-theme", "r-rail", true);
      const html = renderLayout(collapsibleStack, { themeId: "col-theme" });

      expect(html).toContain('data-state="collapsed"');
      expect(html).toContain("Mini Rail");
      expect(html).not.toContain("Full Rail Content");
    });
  });

  describe("Resizable Region & Handle", () => {
    const resizableBox: LayoutNode = {
      type: "box",
      id: "r-sidebar",
      width: "240px",
      resizable: {
        edge: "right",
        min: "160px",
        max: "400px",
      },
      children: [{ type: "text", value: "Sidebar Body" }],
    };

    it("renders resize handle with ARIA separator semantics", () => {
      const html = renderLayout(resizableBox, { themeId: "res-theme" });

      expect(html).toContain('data-part="resize-handle"');
      expect(html).toContain('data-edge="right"');
      expect(html).toContain('role="separator"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('aria-orientation="vertical"');
      expect(html).toContain('aria-valuenow="240"');
      expect(html).toContain('aria-valuemin="160"');
      expect(html).toContain('aria-valuemax="400"');
      expect(html).toContain('aria-label="Resize r-sidebar"');
    });

    it("applies horizontal orientation for top and bottom edges", () => {
      const html = renderToStaticMarkup(
        <ResizableHandle
          node={{
            id: "bottom-panel",
            resizable: { edge: "bottom", min: "100px", max: "300px" },
            height: "150px",
          }}
        />,
      );

      expect(html).toContain('data-edge="bottom"');
      expect(html).toContain('aria-orientation="horizontal"');
      expect(html).toContain('aria-valuenow="150"');
    });

    it("calculates 8px keyboard steps and clamps to limits", () => {
      const stepRight = handleResizeKey({
        key: "ArrowRight",
        edge: "right",
        current: 200,
        min: 160,
        max: 400,
      });
      expect(stepRight).toBe(208);

      const stepLeft = handleResizeKey({
        key: "ArrowLeft",
        edge: "right",
        current: 200,
        min: 160,
        max: 400,
      });
      expect(stepLeft).toBe(192);

      const homeKey = handleResizeKey({
        key: "Home",
        edge: "right",
        current: 200,
        min: 160,
        max: 400,
      });
      expect(homeKey).toBe(160);

      const endKey = handleResizeKey({
        key: "End",
        edge: "right",
        current: 200,
        min: 160,
        max: 400,
      });
      expect(endKey).toBe(400);

      const clampMax = handleResizeKey({
        key: "ArrowRight",
        edge: "right",
        current: 398,
        min: 160,
        max: 400,
      });
      expect(clampMax).toBe(400);
    });

    it("applies persisted size to container width/height", () => {
      setPersistedSize("res-theme", "r-sidebar", "320px");
      const html = renderLayout(resizableBox, { themeId: "res-theme" });

      expect(html).toContain("width:320px");
      expect(html).toContain('aria-valuenow="320"');
    });

    it("parses length in px correctly", () => {
      expect(parseLengthPx("250px", 100)).toBe(250);
      expect(parseLengthPx(undefined, 100)).toBe(100);
      expect(parseLengthPx("invalid", 100)).toBe(100);
    });
  });

  describe("ModalHost", () => {
    it("renders modal with dim backdrop and center placement by default", () => {
      const html = renderToStaticMarkup(
        <ModalHost
          file={{
            schemaVersion: 2,
            backdrop: "dim",
            placement: { mode: "center" },
            root: { type: "text", value: "Modal Dialog Body" },
          }}
          onClose={() => {}}
        />,
      );

      expect(html).toContain('data-modal-host=""');
      expect(html).toContain('data-backdrop="dim"');
      expect(html).toContain('data-placement="center"');
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain("Modal Dialog Body");
    });

    it("renders backdrop: none without dim background", () => {
      const html = renderToStaticMarkup(
        <ModalHost
          file={{
            schemaVersion: 2,
            backdrop: "none",
            placement: { mode: "anchor", anchor: "topRight", x: "10px", y: "20px" },
            root: { type: "text", value: "Anchored Modal" },
          }}
          onClose={() => {}}
        />,
      );

      expect(html).toContain('data-backdrop="none"');
      expect(html).toContain('data-placement="anchor"');
      expect(html).toContain("Anchored Modal");
    });

    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        <ModalHost
          file={{
            schemaVersion: 2,
            root: { type: "text", value: "Hidden Modal" },
          }}
          isOpen={false}
          onClose={() => {}}
        />,
      );

      expect(html).toBe("");
    });
  });

  describe("PopupHost", () => {
    it("renders anchored popup with side and alignment attributes", () => {
      const html = renderToStaticMarkup(
        <PopupHost
          file={{
            schemaVersion: 2,
            placement: {
              mode: "anchored",
              side: "bottom",
              align: "start",
              offset: "6px",
              maxHeight: "280px",
            },
            root: { type: "text", value: "Popup Content" },
          }}
          onClose={() => {}}
        />,
      );

      expect(html).toContain('data-popup-host=""');
      expect(html).toContain('data-mode="anchored"');
      expect(html).toContain('data-side="bottom"');
      expect(html).toContain('data-align="start"');
      expect(html).toContain('role="dialog"');
      expect(html).toContain("Popup Content");
    });

    it("renders region and inline mode popups", () => {
      const regionHtml = renderToStaticMarkup(
        <PopupHost
          file={{
            schemaVersion: 2,
            placement: { mode: "region" },
            root: { type: "text", value: "Drawer Popup" },
          }}
          onClose={() => {}}
        />,
      );
      expect(regionHtml).toContain('data-mode="region"');
      expect(regionHtml).toContain("Drawer Popup");

      const inlineHtml = renderToStaticMarkup(
        <PopupHost
          file={{
            schemaVersion: 2,
            placement: { mode: "inline" },
            root: { type: "text", value: "Inline Popup" },
          }}
          onClose={() => {}}
        />,
      );
      expect(inlineHtml).toContain('data-mode="inline"');
      expect(inlineHtml).toContain("Inline Popup");
    });
  });

  describe("SettingsHost", () => {
    it("renders settings with overlay presentation over named region", () => {
      const html = renderToStaticMarkup(
        <SettingsHost
          file={{
            schemaVersion: 2,
            presentation: { mode: "overlay", region: "r-main" },
            root: { type: "text", value: "Overlay Settings" },
          }}
        />,
      );

      expect(html).toContain('data-settings-host=""');
      expect(html).toContain('data-presentation="overlay"');
      expect(html).toContain('data-region="r-main"');
      expect(html).toContain("Overlay Settings");
      expect(html).toContain("position:absolute");
      expect(html).toContain("inset:0");
      expect(html).toContain("width:100%");
      expect(html).toContain("height:100%");
    });

    it("renders view and panel presentation modes", () => {
      const viewHtml = renderToStaticMarkup(
        <SettingsHost
          file={{
            schemaVersion: 2,
            presentation: { mode: "view" },
            root: { type: "text", value: "View Settings" },
          }}
        />,
      );
      expect(viewHtml).toContain('data-settings-host=""');
      expect(viewHtml).toContain('data-presentation="view"');
      expect(viewHtml).toContain("View Settings");
      expect(viewHtml).toContain("width:100%");
      expect(viewHtml).toContain("height:100%");

      const panelHtml = renderToStaticMarkup(
        <SettingsHost
          file={{
            schemaVersion: 2,
            presentation: { mode: "panel", region: "r-side" },
            root: { type: "text", value: "Panel Settings" },
          }}
        />,
      );
      expect(panelHtml).toContain('data-settings-host=""');
      expect(panelHtml).toContain('data-presentation="panel"');
      expect(panelHtml).toContain('data-region="r-side"');
      expect(panelHtml).toContain("Panel Settings");
      expect(panelHtml).toContain("display:contents");
      expect(panelHtml).not.toContain("width:100%");
      expect(panelHtml).not.toContain("height:100%");
    });

    it("defaults to overlay presentation when the file omits it", () => {
      const html = renderToStaticMarkup(
        <SettingsHost file={{ schemaVersion: 2, root: { type: "text", value: "Untagged" } }} />,
      );
      expect(html).toContain('data-presentation="overlay"');
    });
  });

  describe("SettingsRegionPortal", () => {
    // No DOM is available to resolve a target region in these tests (they run
    // under react-dom/server, which never fires effects), so every case here
    // exercises the exact path SPEC §9.4 requires: an overlay/panel whose
    // region can't be found renders nothing instead of covering the window.
    it("renders nothing for overlay presentation until its region resolves", () => {
      const html = renderToStaticMarkup(
        <SettingsRegionPortal
          file={{
            schemaVersion: 2,
            presentation: { mode: "overlay", region: "r-main" },
            root: { type: "text", value: "Overlay Settings" },
          }}
        />,
      );
      expect(html).toBe("");
    });

    it("renders nothing for panel presentation until its region resolves", () => {
      const html = renderToStaticMarkup(
        <SettingsRegionPortal
          file={{
            schemaVersion: 2,
            presentation: { mode: "panel", region: "r-side" },
            root: { type: "text", value: "Panel Settings" },
          }}
        />,
      );
      expect(html).toBe("");
    });

    it("stays inactive for view presentation — the caller owns that mode", () => {
      const html = renderToStaticMarkup(
        <SettingsRegionPortal
          file={{
            schemaVersion: 2,
            presentation: { mode: "view" },
            root: { type: "text", value: "View Settings" },
          }}
        />,
      );
      expect(html).toBe("");
    });

    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        <SettingsRegionPortal
          file={{
            schemaVersion: 2,
            presentation: { mode: "overlay", region: "r-main" },
            root: { type: "text", value: "Overlay Settings" },
          }}
          isOpen={false}
        />,
      );
      expect(html).toBe("");
    });
  });
});
