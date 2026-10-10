import { describe, expect, it } from "vitest";
import { isElementInLayout } from "../layout-query";
import { SERVERS_LIST } from "./servers-list";
import { expectRequiredPlaced } from "./test-helpers";

describe("Neutral servers list", () => {
  it("places every element it requires", () => {
    expectRequiredPlaced("list:servers/row", SERVERS_LIST);
  });

  it("servers list row contains list:servers/row required elements and withJoin notice", () => {
    expect(isElementInLayout(SERVERS_LIST, "server.join")).toBe(true);
    expect(isElementInLayout(SERVERS_LIST, "server.actionNotice")).toBe(true);
  });
});
