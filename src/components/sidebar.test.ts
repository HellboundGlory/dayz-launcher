/** The sidebar's two-level ordering against the shapes a resolved layout can
 * hand it: a full explicit order, a partial one (required children appended in
 * registry order), and an order naming ids this slot doesn't have. */
import { describe, expect, it } from "vitest";
import { NAV_IDS, TOP_GROUPS, orderedByLayout } from "./sidebar";

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
