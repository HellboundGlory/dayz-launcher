import { describe, it } from "vitest";
import { MOD_FILTER_RESULTS_LIST } from "./mod-filter-results";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mod filter results list", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("list:modFilterResults/row", MOD_FILTER_RESULTS_LIST);
  });
});
