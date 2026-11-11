import { afterEach, describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Server } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { useLanStore } from "@/stores/lan-store";
import { refreshTargets, useRefreshLoops } from "./use-refresh-loops";

const { refreshVisibleServers, scanLan } = vi.hoisted(() => ({
  refreshVisibleServers: vi.fn(async () => {}),
  scanLan: vi.fn(async () => [] as string[]),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, refreshVisibleServers, scanLan };
});

const addr = (i: number) => `10.0.0.${i}`;
const list = (length: number, holes: number[] = []) =>
  Array.from({ length }, (_, i) =>
    holes.includes(i) ? undefined : ({ addr: addr(i) } as Server),
  );

afterEach(() => {
  refreshVisibleServers.mockClear();
  scanLan.mockClear();
  useServerStore.setState({
    servers: [],
    filter: { ...useServerStore.getState().filter, lan_addrs: null },
  });
  useLanStore.setState({ state: "idle", addrs: [] });
});

/** Renders the hook and hands back its Refresh, which the element context fires on a click. */
function refresher() {
  let refresh: (() => void) | null = null;
  const Probe = () => {
    refresh = useRefreshLoops({
      steamConnected: true,
      runInitialLoad: vi.fn(async () => {}),
      setError: vi.fn(),
      setRefreshing: vi.fn(),
      setRefreshedAt: vi.fn(),
    }).handleRefresh;
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return refresh!;
}

describe("refreshTargets", () => {
  it.each([
    { name: "top of the list", range: { start: 0, end: 1 }, holes: [], cap: undefined, want: [0, 1, 2, 3] },
    { name: "middle of the list", range: { start: 8, end: 9 }, holes: [], cap: undefined, want: [6, 7, 8, 9, 10, 11] },
    { name: "end clamps to the last row", range: { start: 17, end: 19 }, holes: [], cap: undefined, want: [14, 15, 16, 17, 18, 19] },
    { name: "unloaded rows are skipped", range: { start: 4, end: 4 }, holes: [3], cap: undefined, want: [4, 5] },
    { name: "cap keeps the first rows in order", range: { start: 8, end: 9 }, holes: [], cap: 3, want: [6, 7, 8] },
  ])("$name", ({ range, holes, cap, want }) => {
    const servers = list(20, holes);
    expect(refreshTargets(servers, range, cap).map((s) => s.addr)).toEqual(want.map(addr));
  });
});

describe("handleRefresh", () => {
  it("rescans the LAN tab instead of re-asking the rows on screen", async () => {
    useServerStore.setState({
      servers: list(4),
      visibleRange: { start: 0, end: 0 },
      filter: { ...useServerStore.getState().filter, lan_addrs: [] },
    });

    refresher()();
    await vi.waitFor(() => expect(scanLan).toHaveBeenCalled());

    expect(refreshVisibleServers).not.toHaveBeenCalled();
  });

  it("re-asks the rows on screen on every other tab", async () => {
    useServerStore.setState({
      servers: list(4),
      visibleRange: { start: 0, end: 0 },
      filter: { ...useServerStore.getState().filter, lan_addrs: null },
    });

    refresher()();
    await vi.waitFor(() => expect(refreshVisibleServers).toHaveBeenCalled());

    expect(scanLan).not.toHaveBeenCalled();
  });
});

