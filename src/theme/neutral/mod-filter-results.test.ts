import { describe, expect, it } from "vitest";
import { isElementInLayout } from "../layout-query";
import { MOD_FILTER_RESULTS_LIST } from "./mod-filter-results";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mod filter results list", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("list:modFilterResults/row", MOD_FILTER_RESULTS_LIST);
  });

  it("modFilterResults list row contains list:modFilterResults/row required elements", () => {
    expect(isElementInLayout(MOD_FILTER_RESULTS_LIST, "workshopMod.pick")).toBe(true);
  });
});
