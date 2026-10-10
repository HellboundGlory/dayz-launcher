import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { loadServerRows } from "./use-server-data-loader";

const { getServerList } = vi.hoisted(() => ({
  getServerList: vi.fn<() => Promise<Server[]>>(),
}));

vi.mock("@/lib/tauri", () => ({
  getServerList,
  getMapList: vi.fn(async () => []),
  logClient: vi.fn(async () => {}),
}));

const query = {
  filterParams: {} as never,
  sortParams: {} as never,
};

beforeEach(() => {
  getServerList.mockReset();
  useServerStore.setState({ loadError: null });
});

describe("loadServerRows", () => {
  it("surfaces a failed load and clears it on the next success", async () => {
    getServerList.mockRejectedValueOnce(new Error("registry not opened"));

    await loadServerRows(query);

    expect(useServerStore.getState().loadError).toContain("registry not opened");

    getServerList.mockResolvedValueOnce([]);

    await loadServerRows(query);

    expect(useServerStore.getState().loadError).toBeNull();
  });
});
