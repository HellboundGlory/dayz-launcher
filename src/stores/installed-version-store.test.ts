import { beforeEach, describe, expect, it, vi } from "vitest";

const getInstalledDayzVersion = vi.fn<(path: string | null) => Promise<string | null>>();

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, getInstalledDayzVersion };
});

async function freshStore() {
  vi.resetModules();
  getInstalledDayzVersion.mockReset();
  return import("./installed-version-store");
}

describe("loadInstalledVersion", () => {
  beforeEach(() => {
    getInstalledDayzVersion.mockResolvedValue(null);
  });

  it("reads once for callers sharing a DayZ folder", async () => {
    const store = await freshStore();
    getInstalledDayzVersion.mockResolvedValue("1.30.164289");

    const [a, b] = await Promise.all([
      store.loadInstalledVersion("/games/DayZ"),
      store.loadInstalledVersion("/games/DayZ"),
    ]);

    expect(a).toBe("1.30.164289");
    expect(b).toBe("1.30.164289");
    expect(getInstalledDayzVersion).toHaveBeenCalledTimes(1);
  });

  it("keeps no failed read, so the next call reads again", async () => {
    const store = await freshStore();
    getInstalledDayzVersion.mockRejectedValueOnce(new Error("busy"));
    await expect(store.loadInstalledVersion("/games/DayZ")).resolves.toBeNull();
    getInstalledDayzVersion.mockResolvedValueOnce("1.30.164289");

    await expect(store.loadInstalledVersion("/games/DayZ")).resolves.toBe("1.30.164289");
    expect(getInstalledDayzVersion).toHaveBeenCalledTimes(2);
  });

  it("reads again on a fresh request, so a DayZ update is seen", async () => {
    const store = await freshStore();
    getInstalledDayzVersion.mockResolvedValueOnce("1.29.163709");
    await store.loadInstalledVersion("/games/DayZ");
    getInstalledDayzVersion.mockResolvedValueOnce("1.30.164289");

    await expect(store.loadInstalledVersion("/games/DayZ", { fresh: true })).resolves.toBe(
      "1.30.164289",
    );
  });

  it("reads again when the DayZ folder changes", async () => {
    const store = await freshStore();
    getInstalledDayzVersion.mockResolvedValueOnce("1.29.163709");
    await store.loadInstalledVersion("/games/DayZ");
    getInstalledDayzVersion.mockResolvedValueOnce("1.30.164289");

    expect(await store.loadInstalledVersion("/other/DayZ")).toBe("1.30.164289");
    expect(getInstalledDayzVersion).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed read as null", async () => {
    const store = await freshStore();
    getInstalledDayzVersion.mockRejectedValue(new Error("no folder"));

    expect(await store.loadInstalledVersion(null)).toBeNull();
  });
});
