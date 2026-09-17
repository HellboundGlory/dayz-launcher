import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Server } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { ServerRowActions, MENU_ITEMS, MENU_ITEM_IDS } from "./server-row-actions";
import type { ResolvedNode } from "@/theme/component-tree";

const mockUseComponentComposition = vi.fn();
vi.mock("@/theme/use-component-composition", () => ({
  useComponentComposition: (slotId: string) => mockUseComponentComposition(slotId),
}));

const mockServerActions = {
  op: null,
  dayzUp: false,
  launchResult: null,
  notice: null as { kind: "code"; code: "W01" | "W02" | "W03" | "W04" | "E01"; extra?: string } | { kind: "plain"; text: string } | null,
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
    mockUseComponentComposition.mockReturnValue(null);
    mockServerActions.notice = null;
    useServerStore.setState({ modPending: {} });
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
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );
      expect(html).toContain("Mod versions not checked");
    });

    it("renders notice in composed path", () => {
      mockServerActions.notice = { kind: "code", code: "W01" };
      const compositionTree: ResolvedNode = {
        type: "stack",
        children: [{ type: "core", ref: "joinAction" }],
      };
      mockUseComponentComposition.mockReturnValue(compositionTree);

      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );
      expect(html).toContain("Mod versions not checked");
    });

    it("renders error code notice with text-danger", () => {
      mockServerActions.notice = { kind: "code", code: "E01" };
      const html = renderToStaticMarkup(
        <ServerRowActions server={baseServer} onMoreInfo={() => {}} />,
      );
      expect(html).toContain("Could not subscribe");
      expect(html).toContain("text-danger");
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
