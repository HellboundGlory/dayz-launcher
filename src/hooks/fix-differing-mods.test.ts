import { describe, expect, it, vi } from "vitest";
import type { Server } from "@/types/server";

const reinstallSubscribedMod = vi.fn<(id: string) => Promise<void>>();
const steamModStates = vi.fn<(ids: string[]) => Promise<{ workshop_id: string; state: string }[]>>();
const invalidateReadiness = vi.fn();

vi.mock("@/lib/tauri", () => ({ reinstallSubscribedMod, steamModStates }));
vi.mock("@/stores/readiness-store", () => ({ invalidateReadiness }));

const server = {
  addr: "46.7.13.31",
  query_port: 2303,
  name: "Some Server",
} as Server;

async function run(ids: string[], join = vi.fn(() => Promise.resolve())) {
  const { fixDifferingMods } = await import("./fix-differing-mods");
  await fixDifferingMods(server, ids, join);
  return join;
}

describe("fixDifferingMods", () => {
  it("reinstalls each mod in order, drops stale readiness and then joins once", async () => {
    reinstallSubscribedMod.mockReset();
    steamModStates.mockReset();
    invalidateReadiness.mockReset();
    const order: string[] = [];
    reinstallSubscribedMod.mockImplementation((id) => {
      order.push(`reinstall ${id}`);
      return Promise.resolve();
    });
    steamModStates.mockResolvedValue([
      { workshop_id: "10", state: "downloading" },
      { workshop_id: "20", state: "downloading" },
    ]);
    const join = vi.fn(() => {
      order.push("join");
      return Promise.resolve();
    });

    await run(["10", "20"], join);

    expect(order).toEqual(["reinstall 10", "reinstall 20", "join"]);
    expect(invalidateReadiness).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("joins at once when nothing differs", async () => {
    reinstallSubscribedMod.mockReset();
    steamModStates.mockReset();
    invalidateReadiness.mockReset();

    const join = await run([]);

    expect(reinstallSubscribedMod).not.toHaveBeenCalled();
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("sets a notice and does not join when a reinstall fails", async () => {
    reinstallSubscribedMod.mockReset();
    steamModStates.mockReset();
    invalidateReadiness.mockReset();
    reinstallSubscribedMod.mockRejectedValue(new Error("Steam refused"));
    const { useLaunchStore } = await import("@/stores/launch-store");

    const join = await run(["10"]);

    const notice = useLaunchStore.getState().notice;
    expect(notice?.addr).toBe("46.7.13.31");
    expect(notice?.notice.kind).toBe("plain");
    expect(join).not.toHaveBeenCalled();
  });
});
