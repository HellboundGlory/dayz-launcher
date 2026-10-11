import { describe, it } from "vitest";
import { SETTINGS_LAYOUT } from "./settings";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral settings", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("settings", SETTINGS_LAYOUT);
  });
});
