import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { loadServerPage, pagesFor } from "./use-server-data-loader";

const { getServerPage } = vi.hoisted(() => ({
  getServerPage: vi.fn<() => Promise<{ total: number; rows: Server[] }>>(),
}));

vi.mock("@/lib/tauri", () => ({
  getServerPage,
  getMapList: vi.fn(async () => []),
  logClient: vi.fn(async () => {}),
}));

const query = {
  filterParams: {} as never,
  sortKey: "players",
  sortDir: "desc",
};

beforeEach(() => {
  getServerPage.mockReset();
  useServerStore.setState({ loadError: null });
});

describe("loadServerPage", () => {
  it("surfaces a failed load and clears it on the next success", async () => {
    getServerPage.mockRejectedValueOnce(new Error("registry not opened"));

    const failed = await loadServerPage(query, 0, () => true);

    expect(failed.error).toContain("registry not opened");

    getServerPage.mockResolvedValueOnce({ total: 0, rows: [] });

    expect((await loadServerPage(query, 0, () => true)).error).toBeNull();
  });
});

describe("pagesFor", () => {
  it.each([
    ["start of the list", 0, 9, 1000, [0, 1]],
    ["middle of the list", 5000, 5010, 10000, [24, 25, 26]],
    ["end clamped to the total", 9990, 9999, 10000, [48, 49]],
    ["empty list", 0, 0, 0, []],
    ["visible rows across a page boundary", 190, 210, 10000, [0, 1, 2]],
  ])("%s", (_name, start, end, total, expected) => {
    expect(pagesFor(start, end, total, 200)).toEqual(expected);
  });
});

describe("server store pages", () => {
  const row = (addr: string) => ({ addr, query_port: 2302, favourite: false }) as Server;

  it("keeps loaded rows when the total changes, follows a changed selected row, and toggles only the matching row", () => {
    const a = row("10.0.0.1:2302");
    const c = row("10.0.0.3:2302");
    useServerStore.setState({ servers: [a, undefined, c], selectedServer: a });

    const aUpdated = { ...a, players: 5 };
    useServerStore.getState().setServerPage(0, [aUpdated], 3);
    expect(useServerStore.getState().selectedServer).toBe(aUpdated);

    useServerStore.getState().toggleFavourite(c.addr);
    const toggled = useServerStore.getState().servers;
    expect(toggled[1]).toBeUndefined();
    expect(toggled[2]).toEqual({ ...c, favourite: true });

    const d = row("10.0.0.4:2302");
    useServerStore.getState().setServerPage(1, [d], 10);
    const { servers, selectedServer } = useServerStore.getState();
    expect(servers).toHaveLength(10);
    expect(servers[0]).toBe(aUpdated);
    expect(servers[1]).toBe(d);
    expect(servers[2]).toEqual({ ...c, favourite: true });
    expect(servers.slice(3).every((s) => s === undefined)).toBe(true);
    expect(selectedServer).toBe(aUpdated);
  });
});
