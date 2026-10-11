import { describe, it } from "vitest";
import { MODS_LIST } from "./mods-list";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral mods list", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("list:mods/row", MODS_LIST);
  });
});
