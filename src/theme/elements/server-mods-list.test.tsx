import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerModsList, loadServerMods, resolveModsListDisplay } from "./list-elements";
import type { ModReadinessEntry, Server, ServerModReadiness } from "@/types/server";

vi.mock("@/lib/tauri", () => ({
  serverModReadiness: vi.fn(),
}));

import { serverModReadiness } from "@/lib/tauri";

const moddedServer: Pick<Server, "addr" | "query_port" | "modded"> = {
  addr: "127.0.0.1",
  query_port: 27016,
  modded: true,
};

const oneMod: ModReadinessEntry = {
  workshop_id: "111",
  name: "CF",
  state: "ready",
  size_bytes: null,
  size_is_upper_bound: false,
  preview_url: null,
  is_unique: false,
  downloaded_bytes: null,
  total_bytes: null,
};

describe("ServerModsList rendering", () => {
  it("renders the empty state text for a server with no mods, never invented rows", () => {
    const html = renderToStaticMarkup(<ServerModsList state="empty" mods={[]} />);
    expect(html).toContain("This server declares no mods.");
    expect(html).not.toContain("CF");
    expect(html).not.toContain("Community Online Tools");
    expect(html).not.toContain("DayZ-Expansion-Bundle");
  });

  it("renders only the mods actually returned", () => {
    const html = renderToStaticMarkup(<ServerModsList state={undefined} mods={[oneMod]} />);
    expect(html).toContain('data-part="rows"');
    expect(html).not.toContain("This server declares no mods.");
  });

  it("renders the loading state without any rows", () => {
    const html = renderToStaticMarkup(<ServerModsList state="loading" mods={[]} />);
    expect(html).toContain('data-part="loading"');
    expect(html).not.toContain('data-part="rows"');
  });
});

describe("loadServerMods", () => {
  it("resolves to empty for an unmodded server without fetching", async () => {
    const result = await loadServerMods({ ...moddedServer, modded: false });
    expect(result).toEqual({ state: "empty", mods: [] });
    expect(serverModReadiness).not.toHaveBeenCalled();
  });

  it("resolves to empty when the server declares no mods", async () => {
    vi.mocked(serverModReadiness).mockResolvedValueOnce({ stale: false, mods: [] });
    const result = await loadServerMods(moddedServer);
    expect(result).toEqual({ state: "empty", mods: [] });
  });

  it("surfaces a rejected fetch as stale, never as invented mods", async () => {
    vi.mocked(serverModReadiness).mockRejectedValueOnce(new Error("network error"));
    const result = await loadServerMods(moddedServer);
    expect(result.state).toBe("stale");
    expect(result.mods).toEqual([]);
  });
});

describe("resolveModsListDisplay", () => {
  const readyModded: Pick<Server, "modded"> = { modded: true };
  const readinessWithMods: ServerModReadiness = { stale: false, mods: [oneMod] };
  const readinessEmpty: ServerModReadiness = { stale: false, mods: [] };
  const readinessStale: ServerModReadiness = { stale: true, mods: [oneMod] };

  it("maps no selected server to empty with no mods", () => {
    expect(resolveModsListDisplay(null, false, null, [oneMod])).toEqual({ state: "empty", mods: [] });
  });

  it("maps an unmodded server to empty with no mods", () => {
    expect(resolveModsListDisplay({ modded: false }, false, null, [oneMod])).toEqual({
      state: "empty",
      mods: [],
    });
  });

  it("maps a loading fetch to loading with no mods", () => {
    expect(resolveModsListDisplay(readyModded, true, null, [oneMod])).toEqual({
      state: "loading",
      mods: [],
    });
  });

  it("maps a null readiness (failed fetch) to stale, keeping the previously rendered mods", () => {
    expect(resolveModsListDisplay(readyModded, false, null, [oneMod])).toEqual({
      state: "stale",
      mods: [oneMod],
    });
  });

  it("maps a stale readiness to stale, keeping the previously rendered mods", () => {
    expect(resolveModsListDisplay(readyModded, false, readinessStale, [oneMod])).toEqual({
      state: "stale",
      mods: [oneMod],
    });
  });

  it("maps a resolved readiness with mods to undefined state with those mods", () => {
    expect(resolveModsListDisplay(readyModded, false, readinessWithMods, [])).toEqual({
      state: undefined,
      mods: [oneMod],
    });
  });

  it("maps a resolved readiness with no mods to empty with no mods", () => {
    expect(resolveModsListDisplay(readyModded, false, readinessEmpty, [oneMod])).toEqual({
      state: "empty",
      mods: [],
    });
  });
});
