/** Ordering against the real registry and the real resolver: the contract is
 * that a theme which didn't ask to reorder keeps the component's DOM order. */
import { describe, expect, it } from "vitest";
import { resolveChildOrder } from "./slot-order";
import { resolveLayout } from "./layout-store";
import { SLOTS } from "./slots";

type Slots = Record<string, Record<string, unknown>>;

const resolvedFor = (slots?: Slots) =>
  resolveLayout(SLOTS, slots ? { schemaVersion: 1, slots } : null).resolved;

const order = (
  slotId: string,
  markup: string[],
  slots?: Slots,
  wrappers?: Record<string, string[]>,
) => resolveChildOrder(slotId, markup, resolvedFor(slots)[slotId].children, wrappers);

/** mods.toolbar as the toolbar row has it — not the registry's order. */
const TOOLBAR_DOM = ["searchInput", "statusFilter", "refreshAction"];
const toolbar = (slots?: Slots) => order("mods.toolbar", TOOLBAR_DOM, slots);

/** mods.row's own positions, with the .mx-main block standing in for its two. */
const ROW_DOM = [
  "selectCheckbox",
  "modIcon",
  "mxMain",
  "modStatusBadge",
  "sizeLabel",
  "updatedLabel",
];
const ROW_WRAPPERS = { mxMain: ["modName", "modTags"] };
const row = (slots?: Slots) => order("mods.row", ROW_DOM, slots, ROW_WRAPPERS);
const main = (slots?: Slots) => order("mods.row", ["modName", "modTags"], slots);

/** mods.inspector: the body column, and the actions row inside it. */
const INSPECTOR_DOM = ["previewImage", "name", "status", "tags", "description", "detailFields", "inspectorActions"];
const INSPECTOR_ACTIONS_DOM = ["updateAction", "openInSteamAction", "openFolderAction", "reinstallAction"];
const inspectorWrappers = { inspectorActions: INSPECTOR_ACTIONS_DOM };
const inspectorBody = (slots?: Slots) =>
  order("mods.inspector", INSPECTOR_DOM, slots, inspectorWrappers);
const inspectorActions = (slots?: Slots) => order("mods.inspector", INSPECTOR_ACTIONS_DOM, slots);

/** mods.actionBar: the bar's own positions, and the ml-auto cluster inside it. */
const ACTION_BAR_DOM = [
  "totalCount",
  "selectAllAction",
  "clearSelectionAction",
  "actionBarCluster",
  "unsubscribeAction",
  "updateOutdatedAction",
  "verifyAction",
];
const ACTION_BAR_CLUSTER = ["uniqueToServerAction", "cleanupRemovedAction"];

describe("resolveChildOrder with no layout active", () => {
  it("returns each wired group exactly as its markup has it", () => {
    // The whole package's correctness bar: every group a component wires must
    // come back in the JSX's own order, so the DOM sequence is untouched.
    const groups: [string, string[], Record<string, string[]>?][] = [
      ["mods.toolbar", TOOLBAR_DOM],
      ["mods.row", ROW_DOM, ROW_WRAPPERS],
      ["mods.row", ["modName", "modTags"]],
      ["mods.inspector", INSPECTOR_DOM, inspectorWrappers],
      ["mods.inspector", INSPECTOR_ACTIONS_DOM],
      ["mods.actionBar", ACTION_BAR_DOM, { actionBarCluster: ACTION_BAR_CLUSTER }],
      ["mods.actionBar", ACTION_BAR_CLUSTER],
      ["modal.serverInfo", ["statGrid", "readinessStrip", "propsList", "readinessList"]],
    ];
    for (const [slotId, markup, wrappers] of groups) {
      expect(resolveChildOrder(slotId, markup, resolvedFor()[slotId].children, wrappers)).toEqual(
        markup,
      );
    }
  });
});

describe("resolveChildOrder", () => {
  it("does not adopt the registry's order over the markup's", () => {
    // The guard against the registry drifting from the DOM again: a markup
    // sequence the registry disagrees with is left exactly as written, since
    // with no layout.json there is no theme intent to act on.
    const drifted = ["refreshAction", "searchInput", "statusFilter"];
    expect(resolvedFor()["mods.toolbar"].children).not.toEqual(drifted);
    expect(resolveChildOrder("mods.toolbar", drifted, resolvedFor()["mods.toolbar"].children)).toEqual(
      drifted,
    );
    expect(toolbar()).toEqual(TOOLBAR_DOM);
  });

  it("keeps that order when the theme only hid an optional child", () => {
    expect(toolbar({ "mods.toolbar": { hidden: ["statusFilter"] } })).toEqual([
      "searchInput",
      "refreshAction",
    ]);
  });

  it("honours an order the theme gave", () => {
    expect(
      toolbar({ "mods.toolbar": { order: ["refreshAction", "searchInput", "statusFilter"] } }),
    ).toEqual(["refreshAction", "searchInput", "statusFilter"]);
  });

  it("keeps an explicitly placed child ahead of the required ones appended to it", () => {
    // mods.toolbar's required children the order left out are appended by the
    // resolver, and land after it here too.
    expect(toolbar({ "mods.toolbar": { order: ["statusFilter"] } })).toEqual([
      "statusFilter",
      "searchInput",
      "refreshAction",
    ]);
  });

  it("drops an optional child the theme's order left out", () => {
    expect(toolbar({ "mods.toolbar": { order: ["searchInput", "refreshAction"] } })).toEqual([
      "searchInput",
      "refreshAction",
    ]);
  });

  it("renders a required child the resolved list omits entirely", () => {
    expect(resolveChildOrder("mods.toolbar", TOOLBAR_DOM, [])).toEqual([
      "searchInput",
      "refreshAction",
    ]);
  });

  it("ignores ids that belong to another group of the same slot", () => {
    expect(row()).toEqual(ROW_DOM);
  });

  it("keeps the markup's order when a child inside a wrapper is hidden", () => {
    // modTags is hidden, so only modName renders inside .mx-main — the row's
    // positions do not move because of it.
    expect(row({ "mods.row": { hidden: ["modTags"] } })).toEqual(ROW_DOM);
    expect(main({ "mods.row": { hidden: ["modTags"] } })).toEqual(["modName"]);
  });

  it("takes a wrapper's position from the child the theme placed first", () => {
    // modTags is last in the registry and modName first, so the .mx-main block
    // follows modName to the front.
    expect(row({ "mods.row": { order: ["modName", "selectCheckbox"] } })[0]).toBe("mxMain");
  });

  it("drops a wrapper once every child it holds is hidden", () => {
    expect(inspectorBody()).toContain("inspectorActions");
    const allHidden = { "mods.inspector": { hidden: INSPECTOR_ACTIONS_DOM } };
    expect(inspectorBody(allHidden)).not.toContain("inspectorActions");
    expect(inspectorBody(allHidden)[0]).toBe("previewImage");
  });

  it("orders a nested group without disturbing the group it sits in", () => {
    const swapped = {
      "mods.row": {
        order: ["selectCheckbox", "modIcon", "modTags", "modName", "modStatusBadge", "sizeLabel", "updatedLabel"],
      },
    };
    expect(main(swapped)).toEqual(["modTags", "modName"]);
    expect(row(swapped)).toEqual(ROW_DOM);
  });

  it("ranks every group by the theme's order, not just the one it moved", () => {
    // A slot's `order` describes the whole slot, so both groups are ranked by
    // it. Here the body column's ids are listed in one sequence and the actions
    // row's in another, and each group renders in its own subsequence of it.
    const moved = {
      "mods.inspector": {
        order: [
          "closeAction",
          "previewImage",
          "name",
          "status",
          "tags",
          "description",
          "detailFields",
          "reinstallAction",
          "openInSteamAction",
          "openFolderAction",
          "updateAction",
        ],
      },
    };
    expect(inspectorBody(moved)).toEqual(INSPECTOR_DOM);
    expect(inspectorActions(moved)).toEqual([
      "reinstallAction",
      "openInSteamAction",
      "openFolderAction",
      "updateAction",
    ]);
    // The body column's DOM order is not the registry's, so its group is being
    // compared on its own rather than the two orders coinciding.
    expect(resolvedFor()["mods.inspector"].children).not.toEqual(INSPECTOR_DOM);
  });

  it("keeps an unranked required child where the markup put it", () => {
    // resolveLayout appends every required child an order omitted, so this only
    // reaches a component from a resolved list built some other way; without the
    // guard the unranked child would sort to the end of its group.
    expect(resolveChildOrder("mods.toolbar", TOOLBAR_DOM, ["refreshAction"])).toEqual([
      "searchInput",
      "refreshAction",
    ]);
  });

  it("falls back to the markup's own order for a slot it has no ids for", () => {
    expect(
      resolveChildOrder("no.such.slot", TOOLBAR_DOM, resolvedFor()["mods.toolbar"].children),
    ).toEqual(TOOLBAR_DOM);
  });
});
