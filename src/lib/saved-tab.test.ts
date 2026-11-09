import { describe, expect, it } from "vitest";
import type { ServerFilter } from "@/types/filters";
import { filterForView, isSavedTab } from "./saved-tab";

const filter = (overrides: Partial<ServerFilter>): ServerFilter =>
  ({
    favourites_only: false,
    recent_only: false,
    lan_addrs: null,
    ...overrides,
  }) as ServerFilter;

describe("isSavedTab", () => {
  it.each([
    { name: "all servers", filter: filter({}), want: false },
    { name: "favourites", filter: filter({ favourites_only: true }), want: true },
    { name: "recent", filter: filter({ recent_only: true }), want: true },
    { name: "lan with no servers yet", filter: filter({ lan_addrs: [] }), want: true },
    { name: "lan with servers", filter: filter({ lan_addrs: ["10.0.0.2:27016"] }), want: true },
  ])("$name -> $want", ({ filter: subject, want }) => {
    expect(isSavedTab(subject)).toBe(want);
  });
});

describe("filterForView", () => {
  it("points the list at the stored LAN addresses on the LAN tab and lets go of them elsewhere", () => {
    expect(filterForView("lan", ["10.0.0.7:27016"])).toEqual({
      favourites_only: false,
      recent_only: false,
      lan_addrs: ["10.0.0.7:27016"],
    });
    for (const view of ["servers", "fav", "recent", "mods"] as const) {
      expect(filterForView(view, ["10.0.0.7:27016"]).lan_addrs).toBeNull();
    }
    expect(filterForView("fav", []).favourites_only).toBe(true);
    expect(filterForView("recent", []).recent_only).toBe(true);
  });
});
