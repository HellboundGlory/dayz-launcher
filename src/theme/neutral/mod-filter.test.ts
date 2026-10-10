import { describe, expect, it } from "vitest";
import { isElementInLayout } from "../layout-query";
import { MOD_FILTER_MODAL } from "./mod-filter";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mod filter modal", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("modal:modFilter", MOD_FILTER_MODAL);
  });

  it("modFilter modal contains all modal:modFilter required elements", () => {
    expect(isElementInLayout(MOD_FILTER_MODAL, "modal.close")).toBe(true);
    expect(isElementInLayout(MOD_FILTER_MODAL, "modFilter.apply")).toBe(true);
    expect(isElementInLayout(MOD_FILTER_MODAL, "list.modFilterResults")).toBe(true);
  });
});
