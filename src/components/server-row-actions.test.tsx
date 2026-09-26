import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Server } from "@/types/server";
import type * as RowProbeStoreModule from "@/theme/elements/row-probe-store";
import type * as TauriModule from "@/lib/tauri";
import { useServerStore } from "@/stores/server-store";
import { refreshVisibleServers } from "@/lib/tauri";
import { useRowProbeStore } from "@/theme/elements/row-probe-store";
import { ServerRowActions, MENU_ITEMS, MENU_ITEM_IDS } from "./server-row-actions";

// Captures the props of the row buttons as they are created, since
// renderToStaticMarkup discards event handlers and disabled from its HTML.
let captured: Record<string, Record<string, unknown>> = {};

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (type === "button" && props) {
        const key = props["data-tetra-el"] as string | undefined;
        if (key) captured[key] = props;
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

// SSR takes zustand's initial-state snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/theme/elements/row-probe-store", async (importOriginal) => {
  const actual = await importOriginal<typeof RowProbeStoreModule>();
  return { ...actual, useRowProbeStore: liveHook(actual.useRowProbeStore) };
});

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof TauriModule>();
  return { ...actual, refreshVisibleServers: vi.fn(() => Promise.resolve()) };
});

const mockServerActions = {
  op: null,
  dayzUp: false,
  launchResult: null,
  notice: null as { kind: "code"; code: "W01" | "W02" | "W03" | "W04" | "E01"; extra?: string } | { kind: "plain"; text: string } | null,
  noticeAddr: null as string | null,
  setNotice: vi.fn(),
  verifyAndJoin: vi.fn(),
  subscribeOnly: vi.fn(),
  cancelWait: vi.fn(),
  phaseLabel: vi.fn(() => ""),
  NOTICES: {
    W01: { text: "Mod versions not checked", detail: "Steam did not answer" },
    W02: { text: "Downloads stalled", detail: "Nothing progressed" },
    W03: { text: "Gave up waiting for downloads", detail: "Still not finished" },
    W04: { text: "Stopped waiting", detail: "Downloads continue" },
    E01: { text: "Could not subscribe", detail: "Steam refused" },
  },
};

vi.mock("@/hooks/use-server-actions", () => ({
  useServerActions: () => mockServerActions,
  NOTICES: {
    W01: { text: "Mod versions not checked", detail: "Steam did not answer" },
    W02: { text: "Downloads stalled", detail: "Nothing progressed" },
    W03: { text: "Gave up waiting for downloads", detail: "Still not finished" },
    W04: { text: "Stopped waiting", detail: "Downloads continue" },
    E01: { text: "Could not subscribe", detail: "Steam refused" },
  },
}));

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const baseServer: Server = {
  addr: "127.0.0.1",
  game_port: 2302,
  query_port: 27016,
  name: "DayZ Test Server",
  map_display: "Chernarus",
  players: 5,
  max_players: 60,
  ping: 40,
  locked: false,
  vac: true,
  version: "1.25",
  in_game_time: "14:00",
  queue: null,
  day_multiplier: 1,
  night_multiplier: 1,
  mod_count: 3,
  country_code: "US",
  last_played: null,
  favourite: false,
  official: false,
  modded: true,
  first_person: false,
  battleye: true,
  online: true,
};

describe("ServerRowActions", () => {
  beforeEach(() => {
    mockServerActions.notice = null;
    mockServerActions.noticeAddr = null;
    useServerStore.setState({ modPending: {} });
    useRowProbeStore.setState({ probingKey: null });
    captured = {};
  });

  describe("Row refresh button", () => {
    it("renders before the join button with the refresh label", () => {
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );

      expect(html).toContain('aria-label="Refresh this server"');
      expect(html).toContain('title="Re-probe DayZ Test Server"');
      expect(html.indexOf('data-tetra-el="rowRefreshAction"')).toBeLessThan(
        html.indexOf('data-tetra-el="joinAction"'),
      );
      expect(captured.rowRefreshAction.disabled).toBe(false);
      expect(captured.rowRefreshAction.className).toContain(
        "border border-line bg-surface2 p-[5px] text-muted2",
      );
      expect(captured.rowRefreshAction.className).toContain(
        "hover:border-accent-line hover:text-accent",
      );
      expect(captured.rowRefreshAction.className).not.toContain("box-shadow");
    });

    it("disables the button while another row is probing", () => {
      useRowProbeStore.setState({ probingKey: "10.0.0.1:27016" });
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );

      expect(captured.rowRefreshAction.disabled).toBe(true);
      expect(html).not.toContain("animate-spin");
    });

    it("spins the icon while this row is probing", () => {
      useRowProbeStore.setState({
        probingKey: `${baseServer.addr}:${baseServer.query_port}`,
      });
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );

      expect(html).toContain("animate-spin");
      expect(captured.rowRefreshAction.disabled).toBe(false);
    });

    it("stops the row click and re-probes this server only", () => {
      vi.mocked(refreshVisibleServers).mockClear();
      renderToStaticMarkup(<ServerRowActions server={baseServer} onMoreInfo={() => {}} />);

      const stopPropagation = vi.fn();
      (captured.rowRefreshAction.onClick as (e: unknown) => void)({ stopPropagation });

      expect(stopPropagation).toHaveBeenCalled();
      expect(refreshVisibleServers).toHaveBeenCalledWith(
        [{ addr: baseServer.addr, query_port: baseServer.query_port }],
        "row",
      );
      expect(useRowProbeStore.getState().probingKey).toBe(
        `${baseServer.addr}:${baseServer.query_port}`,
      );
    });
  });

  describe("Join button wording variant", () => {
    it("displays 'Fix and join' when mods need download or update", () => {
      const htmlWithProp = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} modPending={true} />,
      );
      expect(htmlWithProp).toContain("Fix and join");
      expect(htmlWithProp).not.toContain(">Join<");

      useServerStore.getState().mergeModPending([{ addr: baseServer.addr, pending: true }]);
      const htmlWithStore = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );
      expect(htmlWithStore).toContain("Fix and join");
    });

    it("displays 'Join' when no mods need download or update (ready or unmodded)", () => {
      const htmlModdedReady = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} modPending={false} />,
      );
      expect(htmlModdedReady).toContain(">Join<");
      expect(htmlModdedReady).not.toContain("Fix and join");

      const unmoddedServer = { ...baseServer, modded: false, mod_count: 0 };
      const htmlUnmodded = renderToStaticMarkup(
        <ServerRowActions server={unmoddedServer} onMoreInfo={() => {}} modPending={true} />,
      );
      expect(htmlUnmodded).toContain(">Join<");
      expect(htmlUnmodded).not.toContain("Fix and join");
    });
  });

  describe("Notice rendering in default and composed paths", () => {
    it("renders notice in default path", () => {
      mockServerActions.notice = { kind: "code", code: "W01" };
      mockServerActions.noticeAddr = baseServer.addr;
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );
      expect(html).toContain("Mod versions not checked");
    });


    it("renders error code notice with text-danger", () => {
      mockServerActions.notice = { kind: "code", code: "E01" };
      mockServerActions.noticeAddr = baseServer.addr;
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );
      expect(html).toContain("Could not subscribe");
      expect(html).toContain("text-danger");
    });

    it("does not render a notice tagged for a different server", () => {
      mockServerActions.notice = { kind: "code", code: "W01" };
      mockServerActions.noticeAddr = "10.0.0.1";
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );
      expect(html).not.toContain("Mod versions not checked");
    });
  });

  describe("New menu items registration", () => {
    it("registers checkModsItem, unsubscribeUniqueItem, copyAddressItem", () => {
      expect(MENU_ITEM_IDS).toContain("checkModsItem");
      expect(MENU_ITEM_IDS).toContain("unsubscribeUniqueItem");
      expect(MENU_ITEM_IDS).toContain("copyAddressItem");

      expect(MENU_ITEMS.checkModsItem.label).toBe("Check mods");
      expect(MENU_ITEMS.unsubscribeUniqueItem.label).toBe("Unsubscribe unique mods");
      expect(MENU_ITEMS.copyAddressItem.label).toBe("Copy address");
    });
  });
});
