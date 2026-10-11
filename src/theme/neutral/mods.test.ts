import { describe, it } from "vitest";
import { MODS_LAYOUT } from "./mods";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mods view", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("view:mods", MODS_LAYOUT);
  });
});
