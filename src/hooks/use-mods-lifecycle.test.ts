import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModStateEntry, DownloadProgress } from "@/lib/tauri";

const steamModStates = vi.fn<(ids: string[]) => Promise<ModStateEntry[]>>();
const steamDownloadProgress = vi.fn<(ids: string[]) => Promise<DownloadProgress[]>>();
vi.mock("@/lib/tauri", () => ({ steamModStates, steamDownloadProgress }));

describe("startModsPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    steamModStates.mockReset();
    steamDownloadProgress.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls immediately and then every 1.5s", async () => {
    const { startModsPoll } = await import("./use-mods-lifecycle");
    steamModStates.mockResolvedValue([{ workshop_id: "1", state: "ready" }]);
    steamDownloadProgress.mockResolvedValue([]);
    const setLive = vi.fn();
    const setProgress = vi.fn();
    const load = vi.fn().mockResolvedValue(undefined);

    startModsPoll(["1"], { setLive, setProgress, load });
    await vi.advanceTimersByTimeAsync(0);
    expect(steamModStates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    expect(steamModStates).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1500);
    expect(steamModStates).toHaveBeenCalledTimes(3);
  });

  it("stops polling once the returned cleanup runs", async () => {
    const { startModsPoll } = await import("./use-mods-lifecycle");
    steamModStates.mockResolvedValue([]);
    steamDownloadProgress.mockResolvedValue([]);
    const setLive = vi.fn();
    const setProgress = vi.fn();
    const load = vi.fn().mockResolvedValue(undefined);

    const stop = startModsPoll(["1"], { setLive, setProgress, load });
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeStop = steamModStates.mock.calls.length;

    stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(steamModStates).toHaveBeenCalledTimes(callsBeforeStop);
  });

  it("reloads the row list once a tracked download finishes", async () => {
    const { startModsPoll } = await import("./use-mods-lifecycle");
    steamModStates
      .mockResolvedValueOnce([{ workshop_id: "1", state: "downloading" }])
      .mockResolvedValueOnce([{ workshop_id: "1", state: "ready" }]);
    steamDownloadProgress.mockResolvedValue([]);
    const setLive = vi.fn();
    const setProgress = vi.fn();
    const load = vi.fn().mockResolvedValue(undefined);

    startModsPoll(["1"], { setLive, setProgress, load });
    await vi.advanceTimersByTimeAsync(0);
    expect(load).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    expect(load).toHaveBeenCalledWith(true);
  });

  it("never lets a rejected poll crash the interval", async () => {
    const { startModsPoll } = await import("./use-mods-lifecycle");
    steamModStates.mockRejectedValue(new Error("steam unreachable"));
    steamDownloadProgress.mockResolvedValue([]);
    const setLive = vi.fn();
    const setProgress = vi.fn();
    const load = vi.fn().mockResolvedValue(undefined);

    startModsPoll(["1"], { setLive, setProgress, load });
    await vi.advanceTimersByTimeAsync(0);
    expect(setLive).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    expect(steamModStates).toHaveBeenCalledTimes(2);
  });
});
