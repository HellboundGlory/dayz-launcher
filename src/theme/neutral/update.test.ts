import { describe, expect, it } from "vitest";
import { isElementInLayout } from "../layout-query";
import { UPDATE_MODAL } from "./update";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral update modal", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("modal:update", UPDATE_MODAL);
  });

  it("update modal contains all modal:update required elements", () => {
    expect(isElementInLayout(UPDATE_MODAL, "modal.close")).toBe(true);
    expect(isElementInLayout(UPDATE_MODAL, "update.install")).toBe(true);
    expect(isElementInLayout(UPDATE_MODAL, "update.viewRelease")).toBe(true);
  });
});
