import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { ElementHost } from "./element-host";
import { SurfaceHost } from "./surface-host";
import { ElementContextProvider, type ElementContextValue } from "./context";
import { LayoutRenderer } from "../renderer/layout-renderer";
import type { LayoutFile } from "../renderer/types";

const render = (children: ReactNode, value?: Partial<ElementContextValue>) =>
  renderToStaticMarkup(<ElementContextProvider value={value}>{children}</ElementContextProvider>);

describe("ElementHost & Elements", () => {
  describe("app.* elements", () => {
    it("renders app window action buttons with icon parts", () => {
      const html = render(
        <div>
          <ElementHost node={{ element: "app.minimize" }} />
          <ElementHost node={{ element: "app.maximize" }} />
          <ElementHost node={{ element: "app.close" }} />
        </div>,
      );

      expect(html).toContain('data-el="app.minimize"');
      expect(html).toContain('data-el="app.maximize"');
      expect(html).toContain('data-el="app.close"');
      expect(html).toContain('data-part="icon"');
      expect(html).toContain('aria-label="Minimize"');
      expect(html).toContain('aria-label="Maximize"');
      expect(html).toContain('aria-label="Close"');
    });

    it("renders app.dragRegion with data-tauri-drag-region", () => {
      const html = render(<ElementHost node={{ element: "app.dragRegion" }} />);
      expect(html).toContain('data-el="app.dragRegion"');
      expect(html).toContain("data-tauri-drag-region");
    });

    it("renders app.logo with image and optional wordmark", () => {
      const withWordmark = render(
        <ElementHost node={{ element: "app.logo", options: { wordmark: true } }} />,
      );
      expect(withWordmark).toContain('data-el="app.logo"');
      expect(withWordmark).toContain('data-part="image"');
      expect(withWordmark).toContain('data-part="wordmark"');
      expect(withWordmark).toContain("TETRA");

      const withoutWordmark = render(
        <ElementHost node={{ element: "app.logo", options: { wordmark: false } }} />,
      );
      expect(withoutWordmark).not.toContain("TETRA");
    });

    it("renders app.collapseToggle with collapsed state", () => {
      const expanded = render(
        <ElementHost node={{ element: "app.collapseToggle", options: { region: "sidebar" } }} />,
        { collapsedRegions: { sidebar: false } },
      );
      expect(expanded).toContain('data-el="app.collapseToggle"');
      expect(expanded).toContain('aria-expanded="true"');
      expect(expanded).toContain('aria-controls="sidebar"');

      const collapsed = render(
        <ElementHost node={{ element: "app.collapseToggle", options: { region: "sidebar" } }} />,
        { collapsedRegions: { sidebar: true } },
      );
      expect(collapsed).toContain('aria-expanded="false"');
      expect(collapsed).toContain('data-state="collapsed"');
    });

    it("renders app.schemeToggle with dark/light states", () => {
      const html = render(<ElementHost node={{ element: "app.schemeToggle" }} />);
      expect(html).toContain('data-el="app.schemeToggle"');
      expect(html).toContain('data-part="icon"');
    });
  });

  describe("nav.* elements", () => {
    it("renders nav items with active and current states", () => {
      const html = render(
        <div>
          <ElementHost node={{ element: "nav.servers" }} />
          <ElementHost node={{ element: "nav.favourites" }} />
          <ElementHost node={{ element: "nav.recent" }} />
          <ElementHost node={{ element: "nav.mods" }} />
          <ElementHost node={{ element: "nav.settings" }} />
        </div>,
        { activeView: "servers", settingsOpen: false },
      );

      expect(html).toContain('data-el="nav.servers"');
      expect(html).toContain('data-state="current"');
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('data-el="nav.favourites"');
      expect(html).toContain('data-el="nav.settings"');
    });

    it("renders nav.settings with open state when settings is open", () => {
      const html = render(<ElementHost node={{ element: "nav.settings" }} />, {
        settingsOpen: true,
      });

      expect(html).toContain('data-state="open"');
      expect(html).toContain('aria-pressed="true"');
    });

    it("respects display: icon mode", () => {
      const html = render(
        <ElementHost node={{ element: "nav.servers", options: { display: "icon" } }} />,
      );
      expect(html).toContain('data-part="icon"');
      expect(html).not.toContain('data-part="label"');
      expect(html).toContain('title="Servers"');
    });
  });

  describe("status.* elements", () => {
    it("renders steam status dot and label", () => {
      const connected = render(<ElementHost node={{ element: "status.steam" }} />, {
        steamConnected: true,
      });
      expect(connected).toContain('data-el="status.steam"');
      expect(connected).toContain('data-state="connected"');
      expect(connected).toContain("Steam connected");

      const disconnected = render(<ElementHost node={{ element: "status.steam" }} />, {
        steamConnected: false,
      });
      expect(disconnected).toContain('data-state="disconnected"');
      expect(disconnected).toContain("Steam not connected");
    });

    it("renders server totals only when Steam is connected", () => {
      const disconnected = render(
        <div>
          <ElementHost node={{ element: "status.serverTotal" }} />
          <ElementHost node={{ element: "status.populated" }} />
        </div>,
        { steamConnected: false, serverCounts: { total: 4200, populated: 1300 } },
      );
      expect(disconnected).toBe("<div></div>");

      const connected = render(
        <div>
          <ElementHost node={{ element: "status.serverTotal" }} />
          <ElementHost node={{ element: "status.populated" }} />
        </div>,
        { steamConnected: true, serverCounts: { total: 4200, populated: 1300 } },
      );
      expect(connected).toContain("4,200");
      expect(connected).toContain("1,300");
      expect(connected).toContain('data-el="status.serverTotal"');
      expect(connected).toContain('data-el="status.populated"');
    });

    it("renders status.listSource with index/steam state", () => {
      const html = render(<ElementHost node={{ element: "status.listSource" }} />, {
        steamConnected: true,
        listSource: "index",
      });
      expect(html).toContain('data-el="status.listSource"');
      expect(html).toContain('data-state="index"');
      expect(html).toContain("Indexed");
    });
  });

  describe("notice.* elements", () => {
    it("renders notice.error only when error is present", () => {
      const noError = render(<ElementHost node={{ element: "notice.error" }} />, {
        error: null,
      });
      expect(noError).toBe("");

      const hasError = render(<ElementHost node={{ element: "notice.error" }} />, {
        error: "Failed to load server list",
      });
      expect(hasError).toContain('data-el="notice.error"');
      expect(hasError).toContain('role="alert"');
      expect(hasError).toContain("Failed to load server list");
      expect(hasError).toContain('data-part="dismiss"');
    });

    it("renders notice.storage only when storage is degraded", () => {
      const normal = render(<ElementHost node={{ element: "notice.storage" }} />, {
        storageDegraded: false,
      });
      expect(normal).toBe("");

      const degraded = render(<ElementHost node={{ element: "notice.storage" }} />, {
        storageDegraded: true,
      });
      expect(degraded).toContain('data-el="notice.storage"');
      expect(degraded).toContain('aria-live="polite"');
      expect(degraded).toContain("running from memory");
    });

    it("renders notice.update only when available and not dismissed", () => {
      const available = render(<ElementHost node={{ element: "notice.update" }} />, {
        updateAvailable: { version: "2.7.0" },
        updateBannerDismissed: false,
      });
      expect(available).toContain('data-el="notice.update"');
      expect(available).toContain("v2.7.0");

      const dismissed = render(<ElementHost node={{ element: "notice.update" }} />, {
        updateAvailable: { version: "2.7.0" },
        updateBannerDismissed: true,
      });
      expect(dismissed).toBe("");
    });
  });

  describe("surfaces & context detail panels", () => {
    it("expands surface.windowControls to min/max/close elements", () => {
      const html = render(<SurfaceHost node={{ surface: "surface.windowControls" }} />);
      expect(html).toContain('data-surface="surface.windowControls"');
      expect(html).toContain('data-el="app.minimize"');
      expect(html).toContain('data-el="app.maximize"');
      expect(html).toContain('data-el="app.close"');
    });

    it("renders context:selection with empty fallback when no server is selected", () => {
      const file: LayoutFile = {
        schemaVersion: 2,
        root: {
          type: "stack",
          context: "selection",
          empty: {
            type: "text",
            value: "Select a server to view details",
            role: "body",
          },
          children: [{ element: "status.steam" }],
        },
      };

      const emptyHtml = render(<LayoutRenderer file={file} />, {
        selectedServer: null,
      });
      expect(emptyHtml).toContain("Select a server to view details");
      expect(emptyHtml).not.toContain('data-el="status.steam"');

      const selectedHtml = render(<LayoutRenderer file={file} />, {
        selectedServer: {
          addr: "127.0.0.1:2302",
          name: "Test Server",
          players: 10,
          max_players: 60,
          ping: 25,
          favourite: false,
          last_played: null,
          map_display: "Chernarus",
          game_port: 2302,
          query_port: 27016,
          locked: false,
          vac: true,
          version: "1.26",
          in_game_time: "12:00",
          queue: null,
          day_multiplier: 1,
          night_multiplier: 1,
          mod_count: 0,
          country_code: "US",
          official: false,
          modded: false,
          first_person: false,
          battleye: true,
          online: true,
        },
        steamConnected: true,
      });
      expect(selectedHtml).not.toContain("Select a server to view details");
      expect(selectedHtml).toContain('data-el="status.steam"');
    });
  });
});
