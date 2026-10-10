import { describe, expect, it } from "vitest";
import { REGISTRY } from "../registry";
import { isElementInLayout } from "../layout-query";
import { MODS_LIST } from "./mods-list";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mods list", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("list:mods/row", MODS_LIST);
  });

  it("mods list row contains list:mods/row required elements", () => {
    expect(isElementInLayout(MODS_LIST, "mod.select")).toBe(true);
    expect(isElementInLayout(MODS_LIST, "mod.status")).toBe(true);
  });

  it("mods list matches declared columns and valid sort keys", () => {
    expect(MODS_LIST.columns).toBeDefined();
    const colIds = MODS_LIST.columns?.map((c) => c.id);
    expect(colIds).toEqual(["name", "status", "size", "updated"]);

    const allowedSorts = REGISTRY.lists["list.mods"].sortKeys;
    for (const col of MODS_LIST.columns ?? []) {
      if (col.sort) {
        expect(allowedSorts).toContain(col.sort);
      }
    }
  });
});
