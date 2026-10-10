import { describe, expect, it } from "vitest";
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
});
