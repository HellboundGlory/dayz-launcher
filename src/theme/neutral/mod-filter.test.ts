import { describe, it } from "vitest";
import { MOD_FILTER_MODAL } from "./mod-filter";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mod filter modal", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("modal:modFilter", MOD_FILTER_MODAL);
  });
});
