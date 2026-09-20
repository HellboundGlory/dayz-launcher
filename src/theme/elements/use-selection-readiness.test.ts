import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerModReadiness } from "@/types/server";

const serverModReadiness = vi.fn<(addr: string, queryPort: number) => Promise<ServerModReadiness>>();
vi.mock("@/lib/tauri", () => ({ serverModReadiness }));

const sample: ServerModReadiness = { stale: false, mods: [] };

describe("use-selection-readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    serverModReadiness.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces the fetch by 250ms", async () => {
    const { scheduleReadinessFetch, __clearReadinessCacheForTests } = await import("./use-selection-readiness");
    __clearReadinessCacheForTests();
    serverModReadiness.mockResolvedValue(sample);

    const onSettled = vi.fn();
    scheduleReadinessFetch("1.2.3.4", 27016, onSettled);

    await vi.advanceTimersByTimeAsync(249);
    expect(serverModReadiness).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(serverModReadiness).toHaveBeenCalledWith("1.2.3.4", 27016);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("caches per server and does not refetch on re-selection", async () => {
    const { scheduleReadinessFetch, getCachedReadiness, __clearReadinessCacheForTests } =
      await import("./use-selection-readiness");
    __clearReadinessCacheForTests();
    serverModReadiness.mockResolvedValue(sample);

    scheduleReadinessFetch("1.2.3.4", 27016, vi.fn());
    await vi.advanceTimersByTimeAsync(250);
    expect(serverModReadiness).toHaveBeenCalledTimes(1);
    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ readiness: sample });

    // Re-selecting the same server is a no-op: cache already has an entry.
    scheduleReadinessFetch("1.2.3.4", 27016, vi.fn());
    await vi.advanceTimersByTimeAsync(250);
    expect(serverModReadiness).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending fetch when the cleanup runs before the debounce fires", async () => {
    const { scheduleReadinessFetch, getCachedReadiness, __clearReadinessCacheForTests } =
      await import("./use-selection-readiness");
    __clearReadinessCacheForTests();
    serverModReadiness.mockResolvedValue(sample);

    const cancel = scheduleReadinessFetch("1.2.3.4", 27016, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(serverModReadiness).not.toHaveBeenCalled();
    expect(getCachedReadiness("1.2.3.4", 27016)).toBeUndefined();
  });

  it("caches a distinct error entry when the fetch rejects", async () => {
    const { scheduleReadinessFetch, getCachedReadiness, __clearReadinessCacheForTests } =
      await import("./use-selection-readiness");
    __clearReadinessCacheForTests();
    serverModReadiness.mockRejectedValue(new Error("steam unreachable"));

    const onSettled = vi.fn();
    scheduleReadinessFetch("1.2.3.4", 27016, onSettled);
    await vi.advanceTimersByTimeAsync(250);

    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ error: true });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
