import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModReadinessEntry, Server, ServerModReadiness } from "@/types/server";
import { JoinLinkBox } from "./join-link-dialog";

const request = { ip: "40.160.57.146", port: 2402, favourite: false };

const server = {
  addr: "40.160.57.146:2402",
  name: "The Wall PVE Nasdara",
  map_display: "Nasdara",
  players: 0,
  max_players: 80,
  ping: 48,
} as Server;

const mod = (state: ModReadinessEntry["state"], size_bytes: number | null): ModReadinessEntry => ({
  workshop_id: "1",
  name: "Some Mod",
  state,
  size_bytes,
  size_is_upper_bound: false,
  preview_url: null,
  is_unique: false,
  downloaded_bytes: null,
  total_bytes: null,
});

const handlers = { onCancel: vi.fn(), onRetry: vi.fn(), onJoin: vi.fn() };

describe("JoinLinkBox", () => {
  it("shows the mods to download and the no-answer state", () => {
    const readiness: ServerModReadiness = {
      stale: false,
      mods: [mod("not_installed", 2 ** 30), mod("needs_update", 2 ** 28), mod("ready", null)],
    };

    const download = renderToStaticMarkup(
      <JoinLinkBox request={request} phase="found" server={server} readiness={readiness} checking={false} dayzRunning={false} {...handlers} />,
    );
    expect(download).toContain("2 of 3 mods need downloading");
    expect(download).toContain("1.25 GB");
    expect(download).toContain("Download 2 mods and join");

    const noAnswer = renderToStaticMarkup(
      <JoinLinkBox request={request} phase="noanswer" server={null} readiness={null} checking={false} dayzRunning={false} {...handlers} />,
    );
    expect(noAnswer).toContain("40.160.57.146:2402 did not answer");
    expect(noAnswer).toContain("Try again");
    expect(noAnswer).not.toContain("Download");
  });
});
