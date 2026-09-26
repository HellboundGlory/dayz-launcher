import { describe, it, expect, beforeEach, vi } from "vitest";

vi.stubGlobal("localStorage", {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});

import { useServerStore } from "@/stores/server-store";
import {
  useModFilterStore,
  pickSummary,
  subscribedForDayz,
  activeEntries,
} from "@/stores/mod-filter-store";
import type { SubscribedMod, KnownMod, WorkshopSearchResult } from "@/lib/tauri";

function mod(overrides: Partial<SubscribedMod> = {}): SubscribedMod {
  return {
    workshop_id: "1",
    locally_disabled: false,
    removed: false,
    for_dayz: true,
    state: "installed",
    size_on_disk: "0",
    install_timestamp: 0,
    folder: null,
    downloaded: null,
    total: null,
    title: "A Mod",
    preview_url: null,
    description: null,
    tags: [],
    workshop_url: null,
    consumer_app_id: null,
    time_created: 0,
    time_updated: 0,
    time_added_to_user_list: 0,
    file_size: 0,
    num_subscriptions: "0",
    num_upvotes: 0,
    num_downvotes: 0,
    score: 0,
    ...overrides,
  } as SubscribedMod;
}

beforeEach(() => {
  useServerStore.getState().resetFilter();
  useServerStore.setState((s) => ({ filter: { ...s.filter, mod_ids: [], mod_ids_exclude: [], mod_match: "any" } }));
  useModFilterStore.setState({
    tab: "subscribed",
    query: "",
    selection: {},
    mode: "any",
    previewId: null,
    meta: {},
    known: null,
    knownLoading: false,
    searchResults: [],
    searchLoading: false,
    searchError: null,
    usage: {},
  });
});

describe("begin/apply round-trip", () => {
  it("begin seeds selection and mode from the server filter", () => {
    useServerStore.getState().setFilter({
      mod_ids: ["a", "b"],
      mod_ids_exclude: ["c"],
      mod_match: "all",
    });

    useModFilterStore.getState().begin();

    const s = useModFilterStore.getState();
    expect(s.selection).toEqual({ a: "include", b: "include", c: "exclude" });
    expect(s.mode).toBe("all");
  });

  it("begin resets transient modal state (tab, query, preview) to defaults", () => {
    useModFilterStore.setState({
      tab: "workshop",
      query: "leftover",
      previewId: "xyz",
      meta: { xyz: { title: "X", previewUrl: null } },
    });

    useModFilterStore.getState().begin();

    const s = useModFilterStore.getState();
    expect(s.tab).toBe("subscribed");
    expect(s.query).toBe("");
    expect(s.previewId).toBeNull();
    expect(s.meta).toEqual({});
  });

  it("apply writes the working selection/mode back to the server filter", () => {
    useModFilterStore.setState({
      selection: { a: "include", b: "exclude" },
      mode: "all",
    });

    useModFilterStore.getState().apply();

    expect(useServerStore.getState().filter.mod_ids).toEqual(["a"]);
    expect(useServerStore.getState().filter.mod_ids_exclude).toEqual(["b"]);
    expect(useServerStore.getState().filter.mod_match).toBe("all");
  });
});

describe("pick cycling", () => {
  const entry = { id: "1", title: "A Mod", previewUrl: null };

  it("cycle goes none -> include -> exclude -> none", () => {
    const { cycle } = useModFilterStore.getState();
    cycle(entry);
    expect(useModFilterStore.getState().selection["1"]).toBe("include");
    cycle(entry);
    expect(useModFilterStore.getState().selection["1"]).toBe("exclude");
    cycle(entry);
    expect(useModFilterStore.getState().selection["1"]).toBeUndefined();
  });

  it("cycle remembers the entry's display meta", () => {
    useModFilterStore.getState().cycle(entry);
    expect(useModFilterStore.getState().meta["1"]).toEqual({ title: "A Mod", previewUrl: null });
  });

  it("setPick toggles a specific state off when reapplied", () => {
    const { setPick } = useModFilterStore.getState();
    setPick(entry, "include");
    expect(useModFilterStore.getState().selection["1"]).toBe("include");
    setPick(entry, "include");
    expect(useModFilterStore.getState().selection["1"]).toBeUndefined();
  });

  it("setPick switches directly from include to exclude", () => {
    const { setPick } = useModFilterStore.getState();
    setPick(entry, "include");
    setPick(entry, "exclude");
    expect(useModFilterStore.getState().selection["1"]).toBe("exclude");
  });
});

describe("tab switch", () => {
  it("setTab clears the preview id and any search error", () => {
    useModFilterStore.setState({ previewId: "1", searchError: "boom" });
    useModFilterStore.getState().setTab("seen");
    const s = useModFilterStore.getState();
    expect(s.tab).toBe("seen");
    expect(s.previewId).toBeNull();
    expect(s.searchError).toBeNull();
  });
});

describe("clear", () => {
  it("clearSelection empties the selection map", () => {
    useModFilterStore.setState({ selection: { a: "include" } });
    useModFilterStore.getState().clearSelection();
    expect(useModFilterStore.getState().selection).toEqual({});
  });
});

describe("selectors", () => {
  it("pickSummary splits a selection into included/excluded id lists", () => {
    expect(pickSummary({ a: "include", b: "exclude", c: "include" })).toEqual({
      included: ["a", "c"],
      excluded: ["b"],
    });
  });

  it("subscribedForDayz keeps only for_dayz, non-removed rows, alphabetised", () => {
    const rows = [
      mod({ workshop_id: "2", title: "Zeta" }),
      mod({ workshop_id: "3", title: "Alpha", for_dayz: false }),
      mod({ workshop_id: "4", title: "Alpha", removed: true }),
      mod({ workshop_id: "1", title: "Beta" }),
    ];
    expect(subscribedForDayz(rows).map((m) => m.workshop_id)).toEqual(["1", "2"]);
  });

  it("activeEntries returns subscribed rows on the subscribed tab, filtered by query", () => {
    const rows = [mod({ workshop_id: "1", title: "Alpha" }), mod({ workshop_id: "2", title: "Beta" })];
    const entries = activeEntries({
      tab: "subscribed",
      query: "alp",
      subscribedRows: subscribedForDayz(rows),
      known: null,
      searchResults: [],
      usage: {},
    });
    expect(entries.map((e) => e.id)).toEqual(["1"]);
    expect(entries[0].subscribed).toBe(true);
  });

  it("activeEntries returns known rows on the seen tab, marking ones also subscribed", () => {
    const known: KnownMod[] = [
      { workshop_id: "1", name: "Alpha", server_count: 3, preview_url: "https://x/a.png" },
      { workshop_id: "9", name: "Other", server_count: 1, preview_url: null },
    ];
    const entries = activeEntries({
      tab: "seen",
      query: "",
      subscribedRows: subscribedForDayz([mod({ workshop_id: "1", title: "Alpha" })]),
      known,
      searchResults: [],
      usage: {},
    });
    expect(entries.map((e) => e.id)).toEqual(["1", "9"]);
    expect(entries[0].subscribed).toBe(true);
    expect(entries[1].subscribed).toBe(false);
    expect(entries.map((e) => e.previewUrl)).toEqual(["https://x/a.png", null]);
  });

  it("activeEntries returns search results on the workshop tab, merging usage counts", () => {
    const searchResults: WorkshopSearchResult[] = [
      {
        workshop_id: "5",
        title: "Search Hit",
        preview_url: null,
        description: "",
        tags: [],
        workshop_url: "",
        time_created: 0,
        time_updated: 0,
        file_size: 0,
        num_subscriptions: "0",
        num_upvotes: 0,
        num_downvotes: 0,
        score: 0,
      },
    ];
    const entries = activeEntries({
      tab: "workshop",
      query: "",
      subscribedRows: [],
      known: null,
      searchResults,
      usage: { "5": 7 },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].serverCount).toBe(7);
  });
});
