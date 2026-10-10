import { describe, expect, it } from "vitest";
import { REGISTRY } from "../registry";
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

  it("servers list matches declared columns and valid sort keys", () => {
    expect(SERVERS_LIST.columns).toBeDefined();
    const colIds = SERVERS_LIST.columns?.map((c) => c.id);
    expect(colIds).toEqual(["favourite", "name", "players", "map", "ping", "actions"]);

    const allowedSorts = REGISTRY.lists["list.servers"].sortKeys;
    for (const col of SERVERS_LIST.columns ?? []) {
      if (col.sort) {
        expect(allowedSorts).toContain(col.sort);
      }
    }
  });
});
