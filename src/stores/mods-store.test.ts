import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerModReadiness, SubscribedMod } from "@/lib/tauri";

const tauri = vi.hoisted(() => ({
  getSubscribedMods: vi.fn(),
  getCaredServers: vi.fn(),
  getUniqueModsFor: vi.fn(),
  getServersNeeding: vi.fn(),
  steamModStates: vi.fn(),
  steamDownloadProgress: vi.fn(),
  verifySubscribedMods: vi.fn(),
  steamUnsubscribeMods: vi.fn(),
  updateSubscribedMods: vi.fn(),
  serverModReadiness: vi.fn(),
}));
vi.mock("@/lib/tauri", () => tauri);

import { useModsStore } from "@/stores/mods-store";
import { getCachedReadiness, setCachedReadiness } from "@/stores/readiness-store";

const readiness: ServerModReadiness = { stale: false, mods: [] };
const ADDR = "1.2.3.4";
const PORT = 27016;

function mod(id: string, overrides: Partial<SubscribedMod> = {}): SubscribedMod {
  return {
    workshop_id: id,
    title: `Mod ${id}`,
    state: "ready",
    size_on_disk: "100",
    time_updated: 100,
    time_added_to_user_list: 100,
    install_timestamp: 100,
    description: "",
    folder: "",
    preview_url: null,
    tags: [],
    num_upvotes: 0,
    num_downvotes: 0,
    removed: false,
    locally_disabled: false,
    for_dayz: true,
    downloaded: null,
    total: null,
    workshop_url: null,
    consumer_app_id: null,
    time_created: 100,
    file_size: 100,
    num_subscriptions: "0",
    score: 0,
    ...overrides,
  };
}

function seedReadiness(): void {
  setCachedReadiness(ADDR, PORT, readiness);
}

beforeEach(() => {
  for (const fn of Object.values(tauri)) fn.mockReset();
  tauri.verifySubscribedMods.mockResolvedValue([]);
  tauri.steamUnsubscribeMods.mockResolvedValue({ failures: [] });
  tauri.updateSubscribedMods.mockResolvedValue(undefined);
  tauri.steamModStates.mockResolvedValue([]);
  tauri.steamDownloadProgress.mockResolvedValue([]);
  tauri.getSubscribedMods.mockImplementation(async () => ({
    rows: useModsStore.getState().rows,
    from_cache: false,
  }));

  useModsStore.setState({
    rows: [mod("1"), mod("2", { removed: true }), mod("3", { state: "needs_update" })],
    selectedIds: new Set(["1"]),
    op: null,
  });
});

describe("mods store readiness invalidation", () => {
  it.each([
    ["verify", () => useModsStore.getState().verifyAll()],
    ["update", () => useModsStore.getState().updateMods(["1"])],
    ["update all outdated", () => useModsStore.getState().updateAllOutdated()],
    ["unsubscribe selected", () => useModsStore.getState().unsubscribeSelected()],
    ["unsubscribe all", () => useModsStore.getState().unsubscribeAll()],
    ["clean up removed", () => useModsStore.getState().cleanupRemoved()],
  ])("clears readiness after %s finishes", async (_name, run) => {
    seedReadiness();
    expect(getCachedReadiness(ADDR, PORT)).toBeDefined();

    await run();

    expect(getCachedReadiness(ADDR, PORT)).toBeUndefined();
  });
});

describe("mods store load", () => {
  it("keeps the rows array when the poll returns the same content", async () => {
    const rows = [mod("1"), mod("2")];
    useModsStore.setState({ rows });
    tauri.getSubscribedMods.mockResolvedValue({
      rows: rows.map((row) => ({ ...row })),
      from_cache: false,
    });
    seedReadiness();

    await useModsStore.getState().load();

    expect(useModsStore.getState().rows).toBe(rows);
    expect(getCachedReadiness(ADDR, PORT)).toBeDefined();
  });

  it("replaces rows and clears readiness when the content changed", async () => {
    const rows = [mod("1")];
    useModsStore.setState({ rows });
    tauri.getSubscribedMods.mockResolvedValue({
      rows: [mod("1", { state: "needs_update" })],
      from_cache: false,
    });
    seedReadiness();

    await useModsStore.getState().load();

    expect(useModsStore.getState().rows).not.toBe(rows);
    expect(getCachedReadiness(ADDR, PORT)).toBeUndefined();
  });
});
