import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerModReadiness } from "@/types/server";

const { serverModReadiness } = vi.hoisted(() => ({
  serverModReadiness: vi.fn<(addr: string, queryPort: number) => Promise<ServerModReadiness>>(),
}));
vi.mock("@/lib/tauri", () => ({ serverModReadiness }));

import { useModsStore } from "@/stores/mods-store";
import {
  scheduleReadinessFetch,
  getCachedReadiness,
  invalidateReadiness,
  setCachedReadiness,
  subscribeReadiness,
} from "./readiness-store";

const sample: ServerModReadiness = { stale: false, mods: [] };

describe("readiness store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    serverModReadiness.mockReset();
    invalidateReadiness();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces the fetch by 250ms", async () => {
    serverModReadiness.mockResolvedValue(sample);
    scheduleReadinessFetch("1.2.3.4", 27016);

    await vi.advanceTimersByTimeAsync(249);
    expect(serverModReadiness).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(serverModReadiness).toHaveBeenCalledWith("1.2.3.4", 27016);
  });

  it("caches per server and does not refetch on re-selection", async () => {
    serverModReadiness.mockResolvedValue(sample);

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);
    expect(serverModReadiness).toHaveBeenCalledTimes(1);
    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ readiness: sample });

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);
    expect(serverModReadiness).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending fetch when the cleanup runs before the debounce fires", async () => {
    serverModReadiness.mockResolvedValue(sample);

    const cancel = scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(100);
    cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(serverModReadiness).not.toHaveBeenCalled();
    expect(getCachedReadiness("1.2.3.4", 27016)).toBeUndefined();
  });

  it("caches a distinct error entry when the fetch rejects", async () => {
    serverModReadiness.mockRejectedValue(new Error("steam unreachable"));

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);

    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ error: true });
  });

  it("notifies consumers when a fetch succeeds", async () => {
    serverModReadiness.mockResolvedValue(sample);
    const listener = vi.fn();
    const unsubscribe = subscribeReadiness(listener);

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("notifies consumers when a fetch fails", async () => {
    serverModReadiness.mockRejectedValue(new Error("steam unreachable"));
    const listener = vi.fn();
    const unsubscribe = subscribeReadiness(listener);

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("invalidates cached entries so the next fetch runs again", async () => {
    serverModReadiness.mockResolvedValue(sample);

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);
    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ readiness: sample });

    invalidateReadiness();
    expect(getCachedReadiness("1.2.3.4", 27016)).toBeUndefined();

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);
    expect(serverModReadiness).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent consumers", async () => {
    serverModReadiness.mockResolvedValue(sample);

    scheduleReadinessFetch("1.2.3.4", 27016);
    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);

    expect(serverModReadiness).toHaveBeenCalledTimes(1);
    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ readiness: sample });
  });

  it("drops a response that started before the last invalidation", async () => {
    let resolveRequest!: (result: ServerModReadiness) => void;
    serverModReadiness.mockReturnValue(
      new Promise<ServerModReadiness>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);
    expect(serverModReadiness).toHaveBeenCalledTimes(1);

    invalidateReadiness();
    resolveRequest(sample);
    await vi.advanceTimersByTimeAsync(0);

    expect(getCachedReadiness("1.2.3.4", 27016)).toBeUndefined();
  });

  it("keeps a result seeded while a fetch is in flight", async () => {
    let resolveRequest!: (result: ServerModReadiness) => void;
    serverModReadiness.mockReturnValue(
      new Promise<ServerModReadiness>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const fresh: ServerModReadiness = { stale: false, mods: [] };

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);
    expect(serverModReadiness).toHaveBeenCalledTimes(1);

    setCachedReadiness("1.2.3.4", 27016, fresh);
    resolveRequest({ stale: true, mods: [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ readiness: fresh });
  });

  it("records a readiness result fetched elsewhere", () => {
    setCachedReadiness("1.2.3.4", 27016, sample);

    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ readiness: sample });
  });

  it("clears the cache when the mods store's rows change identity", async () => {
    serverModReadiness.mockResolvedValue(sample);

    scheduleReadinessFetch("1.2.3.4", 27016);
    await vi.advanceTimersByTimeAsync(250);
    expect(getCachedReadiness("1.2.3.4", 27016)).toEqual({ readiness: sample });

    useModsStore.setState({ rows: [] });

    expect(getCachedReadiness("1.2.3.4", 27016)).toBeUndefined();
  });
});
