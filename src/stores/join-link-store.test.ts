import { describe, it, expect } from "vitest";
import { useJoinLinkStore } from "@/stores/join-link-store";
import type { Server } from "@/types/server";

describe("useJoinLinkStore", () => {
  it("drops a late lookup for the link a newer one replaced", () => {
    const first = { ip: "40.160.57.146", port: 2302, favourite: false };
    const second = { ip: "203.0.113.5", port: 2302, favourite: true };
    const server = { addr: "203.0.113.5:2302" } as Server;
    const store = useJoinLinkStore.getState();

    store.open(first);
    store.open(second);

    expect(store.found(first, server)).toBe(false);
    expect(useJoinLinkStore.getState()).toMatchObject({ request: second, server: null, phase: "asking" });

    expect(store.found(second, server)).toBe(true);
    expect(useJoinLinkStore.getState()).toMatchObject({ server, phase: "found" });
  });
});
