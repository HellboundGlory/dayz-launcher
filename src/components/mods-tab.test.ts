import { describe, expect, it } from "vitest";
import { effectiveModState, sortMods } from "./mods-tab.tsx";
import type { SubscribedMod } from "@/lib/tauri";

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
