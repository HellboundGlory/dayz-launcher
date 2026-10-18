import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsDto } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settings-store";

const { getSettings, patchSettings } = vi.hoisted(() => ({
  getSettings: vi.fn<() => Promise<AppSettingsDto>>(),
  patchSettings: vi.fn<(patch: Partial<AppSettingsDto>) => Promise<AppSettingsDto>>(),
}));

vi.mock("@/lib/tauri", () => ({ getSettings, patchSettings }));

const saved: AppSettingsDto = {
  profileName: "Survivor",
  steamPath: "/steam",
  dayzPath: "/dayz",
  workshopPath: "/workshop",
  maxConcurrentQueries: 256,
  queryTimeoutMs: 1000,
  launchParams: ["-noSplash"],
  closeToTray: true,
  minimiseToTray: false,
  uiScale: 1.25,
  autoRefreshIntervalSecs: 60,
  startWithWindows: false,
  startMinimised: false,
  onJoin: "stay",
  onboardingDismissed: false,
  discordRichPresence: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  getSettings.mockReset();
  patchSettings.mockReset().mockResolvedValue(saved);
  useSettingsStore.setState({ loaded: false, profileName: "", dayzPath: null, launchParams: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("load", () => {
  it("keeps loaded false on failure and never writes the defaults back", async () => {
    getSettings.mockRejectedValue(new Error("no file"));

    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().loaded).toBe(false);

    useSettingsStore.getState().setSetting("profileName", "Typed");
    await vi.advanceTimersByTimeAsync(500);
    await useSettingsStore.getState().flush();

    expect(patchSettings).not.toHaveBeenCalled();
  });
});

describe("setSetting", () => {
  it("debounces a burst into one patch of the keys changed since the last save", async () => {
    getSettings.mockResolvedValue(saved);
    await useSettingsStore.getState().load();

    useSettingsStore.getState().setSetting("profileName", "Night Owl");
    useSettingsStore.getState().setSetting("dayzPath", "/games/dayz");
    await vi.advanceTimersByTimeAsync(399);
    expect(patchSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(patchSettings).toHaveBeenCalledTimes(1);
    expect(patchSettings.mock.calls[0][0]).toEqual({
      profileName: "Night Owl",
      dayzPath: "/games/dayz",
    });

    useSettingsStore.getState().setSetting("profileName", "Dawn Owl");
    await vi.advanceTimersByTimeAsync(400);

    expect(patchSettings).toHaveBeenCalledTimes(2);
    expect(patchSettings.mock.calls[1][0]).toEqual({ profileName: "Dawn Owl" });
  });
});

describe("flush", () => {
  it("saves immediately and cancels the pending debounced write", async () => {
    getSettings.mockResolvedValue(saved);
    await useSettingsStore.getState().load();

    useSettingsStore.getState().setSetting("profileName", "Night Owl");
    await useSettingsStore.getState().flush();

    expect(patchSettings).toHaveBeenCalledTimes(1);
    expect(patchSettings.mock.calls[0][0]).toEqual({ profileName: "Night Owl" });

    await vi.advanceTimersByTimeAsync(500);
    expect(patchSettings).toHaveBeenCalledTimes(1);
  });
});
