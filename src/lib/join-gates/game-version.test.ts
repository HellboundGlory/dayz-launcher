import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "@/types/server";

const loadInstalledVersion = vi.fn<(path: string | null) => Promise<string | null>>();

vi.mock("@/stores/installed-version-store", () => ({ loadInstalledVersion }));

const dayzPath = "/games/DayZ";
vi.mock("@/stores/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/settings-store")>();
  return {
    ...actual,
    useSettingsStore: Object.assign(
      <R,>(sel: (s: { dayzPath: string }) => R) => sel({ dayzPath }),
      { getState: () => ({ dayzPath }) },
    ),
  };
});

const server = {
  addr: "46.7.13.31",
  query_port: 2303,
  name: "Some Server",
  version: "1.28.161464",
} as Server;

/** Lets the gate reach the point where it has asked. */
const settled = () => new Promise((r) => setTimeout(r, 0));

describe("confirmGameVersion", () => {
  beforeEach(async () => {
    loadInstalledVersion.mockReset();
    const { useConfirmStore } = await import("@/stores/confirm-store");
    useConfirmStore.setState({ request: null });
  });

  async function start(version: string | null, toMenu = false) {
    loadInstalledVersion.mockResolvedValue(version);
    const { confirmGameVersion } = await import("./game-version");
    return confirmGameVersion(server, toMenu);
  }

  it("lets the join through when the versions match", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const answer = await start("1.28.161464");

    expect(answer).toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it("lets the join through when the installed version is unknown", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const answer = await start(null);

    expect(answer).toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it("asks with both versions when they differ", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    void start("1.29.163709");
    await settled();

    const request = useConfirmStore.getState().request;
    expect(request?.title).toBe("Different game version");
    expect(request?.confirmLabel).toBe("Join anyway");
    expect(request?.rows).toEqual([
      ["Server", "1.28.161464"],
      ["Yours", "1.29.163709"],
    ]);
    expect(request?.destructive).toBe(false);

    useConfirmStore.getState().resolve(false);
  });

  it("resolves true when the user confirms", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const answer = start("1.29.163709");
    await settled();

    useConfirmStore.getState().resolve(true);

    expect(await answer).toBe(true);
  });

  it("resolves false when the user cancels", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const answer = start("1.29.163709");
    await settled();

    useConfirmStore.getState().resolve(false);

    expect(await answer).toBe(false);
  });

  it("resolves false when the request is replaced", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const answer = start("1.29.163709");
    await settled();

    useConfirmStore.getState().ask("Something else", "Another request.", () => {});

    expect(await answer).toBe(false);
  });

  it("never asks when loading to the menu", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const answer = await start("1.29.163709", true);

    expect(answer).toBe(true);
    expect(useConfirmStore.getState().request).toBeNull();
    expect(loadInstalledVersion).not.toHaveBeenCalled();
  });
});
