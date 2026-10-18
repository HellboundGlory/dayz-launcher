import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore } from "@/stores/server-store";
import type { Server } from "@/types/server";

// The store reads localStorage at module-eval time, but both loaders swallow a
// missing/stub-free global, so importing first is safe. Stub before *using* it.
const writes: [string, string][] = [];
vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: (k: string, v: string) => void writes.push([k, v]),
  removeItem: () => {},
});

const EVERYTHING_ON = {
  maps: ["chernarus"],
  countries: ["DE"],
  hide_empty: true,
  hide_full: true,
  hide_locked: true,
  hide_offline: true,
  max_ping: 50,
  search: "dayz",
  official: true,
  modded: false,
  first_person: true,
  mod_ids: ["abc"],
  mod_match: "all" as const,
  mod_ids_exclude: ["xyz"],
};

beforeEach(() => {
  writes.length = 0;
});

describe("resetFilter", () => {
  it("keeps favourites_only, resets every other field to DEFAULT_FILTER", () => {
    const s = useServerStore.getState();
    s.setFilter({ ...EVERYTHING_ON, favourites_only: true, recent_only: false });
    s.resetFilter();

    expect(useServerStore.getState().filter).toEqual({
      maps: [],
      countries: [],
      hide_empty: false,
      hide_full: false,
      hide_locked: false,
      hide_offline: false,
      max_ping: null,
      search: null,
      favourites_only: true,
      recent_only: false,
      official: null,
      modded: null,
      first_person: null,
      mod_ids: [],
      mod_match: "any",
      mod_ids_exclude: [],
    });
  });

  it("keeps recent_only and drops favourites_only when that is the active tab", () => {
    const s = useServerStore.getState();
    s.setFilter({ ...EVERYTHING_ON, favourites_only: false, recent_only: true });
    s.resetFilter();

    const f = useServerStore.getState().filter;
    expect(f.recent_only).toBe(true);
    expect(f.favourites_only).toBe(false);
    expect(f.search).toBe(null);
    expect(f.max_ping).toBe(null);
    expect(f.maps).toEqual([]);
  });

  it("still persists the resulting filter, minus the transient fields", () => {
    const s = useServerStore.getState();
    s.setFilter({ ...EVERYTHING_ON, favourites_only: true, recent_only: false });
    writes.length = 0;
    s.resetFilter();

    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("tetra.filter.v1");
    const persisted: Record<string, unknown> = JSON.parse(writes[0][1]);
    expect(persisted).toEqual({
      maps: [],
      countries: [],
      hide_empty: false,
      hide_full: false,
      hide_locked: false,
      hide_offline: false,
      max_ping: null,
      official: null,
      modded: null,
      first_person: null,
      mod_ids: [],
      mod_match: "any",
      mod_ids_exclude: [],
    });
    expect("favourites_only" in persisted).toBe(false);
    expect("recent_only" in persisted).toBe(false);
    expect("search" in persisted).toBe(false);
  });
});

describe("patchServers", () => {
  it("updates loaded rows by addr in place and re-points the selection", () => {
    const a = { addr: "a", ping: 40 } as Server;
    const b = { addr: "b", players: 2 } as Server;
    const c = { addr: "c", players: 3 } as Server;
    const bFresh = { ...b, players: 9 };
    const aFresh = { ...a, ping: 30 };
    useServerStore.setState({ servers: [a, undefined, b, c], selectedServer: b });

    useServerStore.getState().patchServers([bFresh, aFresh, { addr: "x" } as Server]);

    const { servers, selectedServer } = useServerStore.getState();
    expect(servers).toEqual([aFresh, undefined, bFresh, c]);
    expect(servers[3]).toBe(c);
    expect(selectedServer).toBe(bFresh);
  });
});

describe("lookup", () => {
  it("survives filter changes that keep the search and clears when it changes", () => {
    const s = useServerStore.getState();
    s.setFilter({ search: "40.160.57.146:2402" });
    s.setLookup({ addr: "40.160.57.146:2402", state: "asking" });

    s.setFilter({ max_ping: 50 });
    expect(useServerStore.getState().lookup).toEqual({ addr: "40.160.57.146:2402", state: "asking" });

    s.setFilter({ search: "40.160.57.146:2403" });
    expect(useServerStore.getState().lookup).toBeNull();
  });
});
