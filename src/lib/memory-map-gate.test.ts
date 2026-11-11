import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = { memoryMapWarning: true };
const setSetting = vi.fn((key: string, value: unknown) => {
  (settings as unknown as Record<string, unknown>)[key] = value;
});
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: { getState: () => ({ ...settings, setSetting }) },
}));

vi.mock("@/lib/tauri", () => ({ getMemoryMapStatus: vi.fn() }));
import { getMemoryMapStatus } from "@/lib/tauri";

vi.mock("@/stores/memory-map-store", () => ({ useMemoryMapStore: { getState: vi.fn() } }));
import { useMemoryMapStore } from "@/stores/memory-map-store";

const status = { current: 65530, recommended: 1048576 };
const ask = vi.fn();

beforeEach(() => {
  settings.memoryMapWarning = true;
  setSetting.mockClear();
  ask.mockReset().mockResolvedValue({ join: true, dontWarn: false });
  vi.mocked(getMemoryMapStatus).mockReset().mockResolvedValue(null);
  vi.mocked(useMemoryMapStore.getState).mockReturnValue({ ask } as never);
});

async function load() {
  return import("./memory-map-gate");
}

describe("checkMemoryMap", () => {
  it("returns true without asking the system when the warning is off", async () => {
    settings.memoryMapWarning = false;
    const { checkMemoryMap } = await load();
    await expect(checkMemoryMap()).resolves.toBe(true);
    expect(getMemoryMapStatus).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    { name: "null", resolved: null },
    { name: "a rejection", resolved: new Error("no such file") },
  ])("returns true with no dialog on $name", async ({ resolved }) => {
    if (resolved instanceof Error) {
      vi.mocked(getMemoryMapStatus).mockRejectedValue(resolved);
    } else {
      vi.mocked(getMemoryMapStatus).mockResolvedValue(resolved);
    }
    const { checkMemoryMap } = await load();
    await expect(checkMemoryMap()).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("passes the status to the dialog", async () => {
    vi.mocked(getMemoryMapStatus).mockResolvedValue(status);
    const { checkMemoryMap } = await load();
    await checkMemoryMap();
    expect(ask).toHaveBeenCalledWith(status);
  });

  it("returns true when the user joins anyway", async () => {
    vi.mocked(getMemoryMapStatus).mockResolvedValue(status);
    ask.mockResolvedValue({ join: true, dontWarn: false });
    const { checkMemoryMap } = await load();
    await expect(checkMemoryMap()).resolves.toBe(true);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("returns false when the user closes the dialog", async () => {
    vi.mocked(getMemoryMapStatus).mockResolvedValue(status);
    ask.mockResolvedValue({ join: false, dontWarn: false });
    const { checkMemoryMap } = await load();
    await expect(checkMemoryMap()).resolves.toBe(false);
    expect(setSetting).not.toHaveBeenCalled();
  });

  it.each([true, false])("turns the warning off for good when told not to warn (join %s)", async (join) => {
    vi.mocked(getMemoryMapStatus).mockResolvedValue(status);
    ask.mockResolvedValue({ join, dontWarn: true });
    const { checkMemoryMap } = await load();
    await expect(checkMemoryMap()).resolves.toBe(join);
    expect(setSetting).toHaveBeenCalledWith("memoryMapWarning", false);
  });
});

describe("memoryMapCommands", () => {
  it("builds the two commands from the recommendation", async () => {
    const { memoryMapCommands } = await load();
    expect(memoryMapCommands(1048576)).toEqual({
      raise: "sudo sysctl -w vm.max_map_count=1048576",
      keep: "echo 'vm.max_map_count=1048576' | sudo tee /etc/sysctl.d/80-dayz.conf",
    });
  });
});
