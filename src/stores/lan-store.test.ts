import { beforeEach, describe, expect, it, vi } from "vitest";

const { scanLan } = vi.hoisted(() => ({ scanLan: vi.fn<() => Promise<string[]>>() }));

vi.mock("@/lib/tauri", () => ({ scanLan }));

async function freshStores() {
  vi.resetModules();
  const lan = await import("./lan-store");
  const server = await import("./server-store");
  return { lan, server };
}

beforeEach(() => {
  scanLan.mockReset();
});

describe("lan store", () => {
  it("stores the addresses a scan found and points the filter at exactly those rows", async () => {
    const { lan, server } = await freshStores();
    // Opening the tab points the list at the addresses the store already holds, before the scan asks.
    server.useServerStore.getState().setFilter({ lan_addrs: [] });
    scanLan.mockResolvedValue(["192.168.1.5:27016", "10.0.0.9:2303"]);

    await lan.useLanStore.getState().scan();

    const state = lan.useLanStore.getState();
    expect(state.state).toBe("done");
    expect(state.addrs).toEqual(["192.168.1.5:27016", "10.0.0.9:2303"]);
    expect(server.useServerStore.getState().filter.lan_addrs).toEqual([
      "192.168.1.5:27016",
      "10.0.0.9:2303",
    ]);
  });

  it("keeps the earlier addresses and reports a failure when the scan rejects", async () => {
    const { lan } = await freshStores();
    scanLan.mockResolvedValueOnce(["10.0.0.5:27016"]);
    await lan.useLanStore.getState().scan();

    scanLan.mockRejectedValueOnce(new Error("Could not read the network interfaces"));
    await lan.useLanStore.getState().scan();

    const state = lan.useLanStore.getState();
    expect(state.state).toBe("failed");
    expect(state.addrs).toEqual(["10.0.0.5:27016"]);
  });

  it("does not start a second scan while one is running", async () => {
    const { lan } = await freshStores();
    let finish: (addrs: string[]) => void = () => {};
    scanLan.mockReturnValue(new Promise<string[]>((resolve) => (finish = resolve)));

    const first = lan.useLanStore.getState().scan();
    expect(lan.useLanStore.getState().state).toBe("scanning");

    await lan.useLanStore.getState().scan();
    expect(scanLan).toHaveBeenCalledTimes(1);

    finish(["10.0.0.7:27016"]);
    await first;
    expect(scanLan).toHaveBeenCalledTimes(1);
  });

  it("treats a reply that is not a list as a failed scan", async () => {
    const { lan } = await freshStores();
    scanLan.mockResolvedValue(null as unknown as string[]);
    await lan.useLanStore.getState().scan();

    expect(lan.useLanStore.getState().state).toBe("failed");
    expect(lan.useLanStore.getState().addrs).toEqual([]);
  });

  it("leaves the filter alone when a scan finds the same addresses again", async () => {
    const { lan, server } = await freshStores();
    server.useServerStore.getState().setFilter({ lan_addrs: [] });
    scanLan.mockResolvedValue(["10.0.0.7:27016"]);
    await lan.useLanStore.getState().scan();
    const before = server.useServerStore.getState().filter;
    await lan.useLanStore.getState().scan();

    expect(server.useServerStore.getState().filter).toBe(before);
  });

  it("does not pull the list back to the LAN tab when a scan lands after it was left", async () => {
    const { lan, server } = await freshStores();
    server.useServerStore.getState().setFilter({ lan_addrs: [] });
    let finish: (addrs: string[]) => void = () => {};
    scanLan.mockReturnValue(new Promise<string[]>((resolve) => (finish = resolve)));

    const scan = lan.useLanStore.getState().scan();
    server.useServerStore.getState().setFilter({ lan_addrs: null });
    finish(["10.0.0.7:27016"]);
    await scan;

    expect(server.useServerStore.getState().filter.lan_addrs).toBeNull();
    expect(lan.useLanStore.getState().addrs).toEqual(["10.0.0.7:27016"]);
  });
});
