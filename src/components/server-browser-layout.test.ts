/** The pixel-identical default depends on one invariant: a slot's registry
 * order IS the order its component renders it in, since `resolveLayout` returns
 * the registry array verbatim when no layout.json is active. These pin that
 * against the markup's real order, so a future edit to either side fails here
 * rather than silently reordering the default row. */
import { describe, expect, it } from "vitest";
import { SLOTS } from "@/theme/slots";
import { SERVER_ROW_GROUPS } from "./server-list";

function registryOrder(slotId: string): string[] {
  const slot = SLOTS.find((candidate) => candidate.id === slotId);
  if (!slot) throw new Error(`no slot '${slotId}' in SLOTS`);
  return slot.children.map((child) => child.id);
}

describe("registry order matches render order", () => {
  it("filterBar: search, dropdowns, ping, Refresh — Refresh last, Reset untagged", () => {
    expect(registryOrder("filterBar")).toEqual([
      "searchInput",
      "mapFilter",
      "tagsFilter",
      "modsFilter",
      "countryFilter",
      "sortControl",
      "pingSlider",
      "refreshAction",
    ]);
  });

  it("server.rowActions: joinAction first (it renders outside the menu), then the menu", () => {
    expect(registryOrder("server.rowActions")).toEqual([
      "joinAction",
      "moreInfoItem",
      "loadToMenuItem",
      "downloadModsItem",
    ]);
  });

  it("server.row: the four groups in DOM order spell out the registry, minus the two that render elsewhere", () => {
    const { favourite, nameLine, details, stats } = SERVER_ROW_GROUPS;
    const grouped: string[] = [...favourite, ...nameLine, ...details, ...stats];
    const registry = registryOrder("server.row");

    expect(registry.filter((id) => grouped.includes(id))).toEqual(grouped);
  });

  it("server.row: no registry child is silently unrendered", () => {
    const grouped: string[] = Object.values(SERVER_ROW_GROUPS).flat();
    // modStatusBadge renders inside tagsLine's own div, on a data condition;
    // every other registry child has a group of its own.
    expect(registryOrder("server.row").filter((id) => !grouped.includes(id))).toEqual([
      "modStatusBadge",
    ]);
  });
});
