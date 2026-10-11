import { describe, it } from "vitest";
import { SERVERS_LIST } from "./servers-list";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral servers list", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("list:servers/row", SERVERS_LIST);
  });
});
