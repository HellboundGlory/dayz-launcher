import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Server, ServerModReadiness } from "@/types/server";
import { ServerInfoModal } from "./server-info-modal";

const mockUseComponentComposition = vi.fn();
vi.mock("@/theme/use-component-composition", () => ({
  useComponentComposition: (slotId: string) => mockUseComponentComposition(slotId),
}));

const mockServerActions = {
  op: null,
  dayzUp: false,
  launchResult: null,
  notice: null,
  setNotice: vi.fn(),
  verifyAndJoin: vi.fn(),
  subscribeOnly: vi.fn(),
  cancelWait: vi.fn(),
  phaseLabel: vi.fn(() => ""),
  NOTICES: {},
};

vi.mock("@/hooks/use-server-actions", () => ({
  useServerActions: () => mockServerActions,
  NOTICES: {},
}));

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

const baseServer: Server = {
  addr: "192.168.1.100",
  game_port: 2302,
  query_port: 27016,
  name: "Survival Sanctuary",
  map_display: "Livonia",
  players: 25,
  max_players: 60,
  ping: 35,
  locked: false,
  vac: true,
  version: "1.25",
  in_game_time: "10:30",
  queue: null,
  day_multiplier: 1,
  night_multiplier: 1,
  mod_count: 3,
  country_code: "DE",
  last_played: null,
  favourite: true,
  official: false,
  modded: true,
  first_person: true,
  battleye: true,
  online: true,
};

const sampleReadiness: ServerModReadiness = {
  stale: false,
  mods: [
    {
      workshop_id: "1001",
      name: "Community Framework (CF)",
      state: "ready",
      size_bytes: null,
      size_is_upper_bound: false,
      preview_url: "https://example.com/cf.jpg",
      is_unique: false,
      downloaded_bytes: null,
      total_bytes: null,
    },
    {
      workshop_id: "2002",
      name: "Custom Armor Pack",
      state: "needs_update",
      size_bytes: 104857600, // 100 MB
      size_is_upper_bound: true, // ADR-0021
      preview_url: null,
      is_unique: true,
      downloaded_bytes: null,
      total_bytes: null,
    },
    {
      workshop_id: "3003",
      name: "Tactical Weapons",
      state: "not_subscribed",
      size_bytes: 52428800, // 50 MB
      size_is_upper_bound: false,
      preview_url: null,
      is_unique: false,
      downloaded_bytes: null,
      total_bytes: null,
    },
  ],
};

describe("ServerInfoModal", () => {
  beforeEach(() => {
    mockUseComponentComposition.mockReturnValue(null);
  });

  describe("Readiness list and formatting", () => {
    it("displays mod names, states, and thumbnail preview when available", () => {
      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={sampleReadiness}
        />,
      );

      expect(html).toContain("Community Framework (CF)");
      expect(html).toContain("Custom Armor Pack");
      expect(html).toContain("Tactical Weapons");

      expect(html).toContain("Ready");
      expect(html).toContain("Needs update");
      expect(html).toContain("Not subscribed");

      expect(html).toContain('src="https://example.com/cf.jpg"');
    });

    it("formats 'up to <size>' when size_is_upper_bound is true (ADR-0021)", () => {
      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={sampleReadiness}
        />,
      );

      expect(html).toContain("up to 100 MB");
      expect(html).toContain("50 MB");
    });

    it("displays Unique badge when is_unique is true", () => {
      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={sampleReadiness}
        />,
      );

      expect(html).toContain("Unique");
    });

    it("displays total download size summary with up to prefix", () => {
      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={sampleReadiness}
        />,
      );

      expect(html).toContain("Download size: up to 150 MB");
    });

    it("displays 'Download size: 0 bytes' when all mods are ready", () => {
      const allReadyReadiness: ServerModReadiness = {
        stale: false,
        mods: [
          {
            workshop_id: "1001",
            name: "Community Framework (CF)",
            state: "ready",
            size_bytes: null,
            size_is_upper_bound: false,
            preview_url: null,
            is_unique: false,
            downloaded_bytes: null,
            total_bytes: null,
          },
        ],
      };

      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={allReadyReadiness}
        />,
      );

      expect(html).toContain("Download size: 0 bytes");
    });
  });

  describe("Modal actions", () => {
    it("renders Check mods, Download mods, Unsubscribe unique, and Copy address action buttons", () => {
      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={sampleReadiness}
        />,
      );

      expect(html).toContain("Check mods");
      expect(html).toContain("Download mods");
      expect(html).toContain("Unsubscribe unique");
      expect(html).toContain("Copy address");
    });
  });

  describe("Join button wording", () => {
    it("displays 'Fix and join' when mods need update or download", () => {
      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={sampleReadiness}
        />,
      );

      expect(html).toContain("Fix and join");
    });

    it("displays 'Join' when all mods are ready", () => {
      const allReadyReadiness: ServerModReadiness = {
        stale: false,
        mods: [
          {
            workshop_id: "1001",
            name: "CF",
            state: "ready",
            size_bytes: null,
            size_is_upper_bound: false,
            preview_url: null,
            is_unique: false,
            downloaded_bytes: null,
            total_bytes: null,
          },
        ],
      };

      const html = renderToStaticMarkup(
        <ServerInfoModal
          server={baseServer}
          onClose={() => {}}
          initialReadiness={allReadyReadiness}
        />,
      );

      expect(html).toContain(">Join<");
      expect(html).not.toContain("Fix and join");
    });
  });
});
