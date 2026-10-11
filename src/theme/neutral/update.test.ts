import { describe, it } from "vitest";
import { UPDATE_MODAL } from "./update";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral update modal", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("modal:update", UPDATE_MODAL);
  });
});
