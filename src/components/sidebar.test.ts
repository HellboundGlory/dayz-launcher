/** The sidebar's two-level ordering against the shapes a resolved layout can
 * hand it: a full explicit order, a partial one (required children appended in
 * registry order), and an order naming ids this slot doesn't have. Plus the
 * resize handle's width bounds. */
import { describe, expect, it } from "vitest";
import {
  NAV_IDS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  TOP_GROUPS,
  clampSidebarWidth,
  orderedByLayout,
} from "./sidebar";

describe("orderedByLayout", () => {
  it("returns the known ids in the order the layout places them", () => {
    expect(
      orderedByLayout(
        ["collapseToggle", "settingsEntry", "navList", "logo"],
        TOP_GROUPS,
      ),
    ).toEqual(["collapseToggle", "settingsEntry", "navList", "logo"]);
  });

  it("restores today's order for the untouched registry default", () => {
    const registry = ["logo", "navList", "navServers", "navFavourites", "navRecent", "navMods", "settingsEntry", "collapseToggle"];

    expect(orderedByLayout(registry, TOP_GROUPS)).toEqual([
      "logo",
      "navList",
      "settingsEntry",
      "collapseToggle",
    ]);
    expect(orderedByLayout(registry, NAV_IDS)).toEqual([
      "navServers",
      "navFavourites",
      "navRecent",
      "navMods",
    ]);
  });

  it("appends a known id the layout left out rather than dropping it", () => {
    expect(orderedByLayout(["navList"], TOP_GROUPS)).toEqual([
      "navList",
      "logo",
      "settingsEntry",
      "collapseToggle",
    ]);
  });

  it("ignores ids that belong to the other nesting level", () => {
    const children = ["navServers", "logo", "navMods", "settingsEntry"];

    expect(orderedByLayout(children, TOP_GROUPS)).toEqual([
      "logo",
      "settingsEntry",
      "navList",
      "collapseToggle",
    ]);
    expect(orderedByLayout(children, NAV_IDS)).toEqual([
      "navServers",
      "navMods",
      "navFavourites",
      "navRecent",
    ]);
  });
});

describe("clampSidebarWidth", () => {
  it("clamps at both bounds and passes an in-range value through", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(200)).toBe(200);
  });

  it("clamps past either bound", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 1)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 1)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("rounds a fractional width", () => {
    expect(clampSidebarWidth(211.4)).toBe(211);
    expect(clampSidebarWidth(211.6)).toBe(212);
  });
});
