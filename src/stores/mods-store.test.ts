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

import { effectiveModState, sortMods, useModsStore } from "@/stores/mods-store";
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

describe("effectiveModState", () => {
  it("defaults to rowState when liveState is absent", () => {
    expect(effectiveModState("ready", undefined)).toBe("ready");
    expect(effectiveModState("needs_update", undefined)).toBe("needs_update");
  });

  it("prioritizes downloading over all states", () => {
    expect(effectiveModState("ready", "downloading")).toBe("downloading");
    expect(effectiveModState("needs_update", "downloading")).toBe("downloading");
  });

  it("never allows a cheap poll's 'ready' to downgrade 'needs_update'", () => {
    expect(effectiveModState("needs_update", "ready")).toBe("needs_update");
  });

  it("reflects uninstalled or unsubscribed live states even if row was needs_update", () => {
    expect(effectiveModState("needs_update", "not_installed")).toBe("not_installed");
    expect(effectiveModState("needs_update", "not_subscribed")).toBe("not_subscribed");
  });

  it("reflects liveState when row was ready", () => {
    expect(effectiveModState("ready", "ready")).toBe("ready");
    expect(effectiveModState("ready", "not_installed")).toBe("not_installed");
    expect(effectiveModState("ready", "needs_update")).toBe("needs_update");
  });
});

describe("sortMods", () => {
  const makeMod = (id: string, overrides: Partial<SubscribedMod> = {}): SubscribedMod => ({
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
  });

  it("sorts by status in asc placing downloading and needs_update ahead of ready", () => {
    const modReady = makeMod("1", { title: "A Mod", state: "ready" });
    const modNeedsUpdate = makeMod("2", { title: "B Mod", state: "needs_update" });
    const modDownloading = makeMod("3", { title: "C Mod", state: "downloading" });

    const sorted = sortMods([modReady, modNeedsUpdate, modDownloading], "status", "asc");
    expect(sorted.map((m) => m.workshop_id)).toEqual(["3", "2", "1"]);
  });

  it("sorts by status in desc placing ready ahead of downloading", () => {
    const modReady = makeMod("1", { title: "A Mod", state: "ready" });
    const modNeedsUpdate = makeMod("2", { title: "B Mod", state: "needs_update" });
    const modDownloading = makeMod("3", { title: "C Mod", state: "downloading" });

    const sorted = sortMods([modReady, modNeedsUpdate, modDownloading], "status", "desc");
    expect(sorted.map((m) => m.workshop_id)).toEqual(["1", "2", "3"]);
  });

  it("tie-breaks status sorting by mod title ascending", () => {
    const modZ = makeMod("1", { title: "Zebra Mod", state: "ready" });
    const modA = makeMod("2", { title: "Alpha Mod", state: "ready" });

    const sortedAsc = sortMods([modZ, modA], "status", "asc");
    expect(sortedAsc.map((m) => m.title)).toEqual(["Alpha Mod", "Zebra Mod"]);

    const sortedDesc = sortMods([modZ, modA], "status", "desc");
    expect(sortedDesc.map((m) => m.title)).toEqual(["Alpha Mod", "Zebra Mod"]);
  });

  it("sorts by name in both directions", () => {
    const modB = makeMod("1", { title: "Bravo" });
    const modA = makeMod("2", { title: "Alpha" });

    const asc = sortMods([modB, modA], "name", "asc");
    expect(asc.map((m) => m.title)).toEqual(["Alpha", "Bravo"]);

    const desc = sortMods([modB, modA], "name", "desc");
    expect(desc.map((m) => m.title)).toEqual(["Bravo", "Alpha"]);
  });

  it("sorts by size in both directions", () => {
    const modSmall = makeMod("1", { size_on_disk: "50" });
    const modLarge = makeMod("2", { size_on_disk: "5000" });

    const asc = sortMods([modLarge, modSmall], "size", "asc");
    expect(asc.map((m) => m.workshop_id)).toEqual(["1", "2"]);

    const desc = sortMods([modLarge, modSmall], "size", "desc");
    expect(desc.map((m) => m.workshop_id)).toEqual(["2", "1"]);
  });

  it("sorts by updated in both directions", () => {
    const modOld = makeMod("1", { time_updated: 1000 });
    const modNew = makeMod("2", { time_updated: 9000 });

    const asc = sortMods([modNew, modOld], "updated", "asc");
    expect(asc.map((m) => m.workshop_id)).toEqual(["1", "2"]);

    const desc = sortMods([modNew, modOld], "updated", "desc");
    expect(desc.map((m) => m.workshop_id)).toEqual(["2", "1"]);
  });

  it("sorts by subscribed in both directions", () => {
    const modOldSub = makeMod("1", { time_added_to_user_list: 10, install_timestamp: 10 });
    const modNewSub = makeMod("2", { time_added_to_user_list: 50, install_timestamp: 50 });

    const asc = sortMods([modNewSub, modOldSub], "subscribed", "asc");
    expect(asc.map((m) => m.workshop_id)).toEqual(["1", "2"]);

    const desc = sortMods([modNewSub, modOldSub], "subscribed", "desc");
    expect(desc.map((m) => m.workshop_id)).toEqual(["2", "1"]);
  });
});
