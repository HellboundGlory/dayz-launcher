import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as SettingsModule from "@/stores/settings-store";
import type {
  DownloadProgress,
  LaunchOutcome,
  ModStateEntry,
  MutationOutcome,
  VerifyOutcome,
} from "@/lib/tauri";
import type { Server } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { useLaunchStore } from "@/stores/launch-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useServerActions } from "./use-server-actions";

const { launchGame, verifyServerMods, steamModStates, steamDownloadProgress, steamSubscribeMods } =
  vi.hoisted(() => ({
    launchGame: vi.fn<(addr: string, gamePort: number, options: unknown) => Promise<LaunchOutcome>>(),
    verifyServerMods: vi.fn<(addr: string, queryPort: number) => Promise<VerifyOutcome>>(),
    steamModStates: vi.fn<(ids: string[]) => Promise<ModStateEntry[]>>(),
    steamDownloadProgress: vi.fn<(ids: string[]) => Promise<DownloadProgress[]>>(),
    steamSubscribeMods: vi.fn<(ids: string[]) => Promise<MutationOutcome>>(),
  }));

vi.mock("@/lib/tauri", () => ({
  logClient: vi.fn(),
  launchGame,
  verifyServerMods,
  steamModStates,
  steamDownloadProgress,
  steamSubscribeMods,
}));

// SSR reads zustand's initial snapshot, so route the settings hook through the
// live state the test sets before rendering.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsModule>();
  return { ...actual, useSettingsStore: liveHook(actual.useSettingsStore) };
});

const server: Server = {
  addr: "1.2.3.4:27016",
  game_port: 2302,
  query_port: 27016,
  name: "Test Server",
  map_display: "Chernarus",
  players: 10,
  max_players: 60,
  ping: 30,
  locked: false,
  vac: true,
  version: "1.25",
  in_game_time: "12:00",
  queue: null,
  day_multiplier: 1,
  night_multiplier: 1,
  mod_count: 1,
  country_code: "DE",
  last_played: null,
  favourite: false,
  official: false,
  modded: true,
  first_person: false,
  battleye: true,
  online: true,
};

let verifyAndJoin!: (target: Server, toMenu?: boolean) => Promise<void>;
let cancelWait!: () => void;

function Probe() {
  const actions = useServerActions();
  verifyAndJoin = actions.verifyAndJoin;
  cancelWait = actions.cancelWait;
  return null;
}

function renderActions() {
  renderToStaticMarkup(createElement(Probe));
}

function declareMods(...mods: { workshop_id: string; name: string }[]) {
  verifyServerMods.mockResolvedValue({ mods, refreshed: [], checked_workshop: true });
}

function stuckDownloading(id: string) {
  steamModStates.mockResolvedValue([{ workshop_id: id, state: "downloading" }]);
  steamDownloadProgress.mockResolvedValue([{ workshop_id: id, downloaded: "500", total: "1000" }]);
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaunchStore.setState({ op: null, result: null, notice: null, dayzRunning: false });
  useServerStore.setState({ downloadsActive: false });
  useSettingsStore.setState({ profileName: "Survivor", dayzPath: "/dayz", launchParams: ["-noSplash"] });

  launchGame.mockReset().mockResolvedValue({
    status: "ok",
    mods_checked: 0,
    mods_ready: 0,
    mods_needing_action: 0,
    message: "DayZ is starting",
  });
  verifyServerMods.mockReset().mockResolvedValue({ mods: [], refreshed: [], checked_workshop: true });
  steamModStates.mockReset().mockResolvedValue([]);
  steamDownloadProgress.mockReset().mockResolvedValue([]);
  steamSubscribeMods.mockReset().mockResolvedValue({ succeeded: 0, failures: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyAndJoin", () => {
  it("launches with the settings' options when the server has no mods", async () => {
    renderActions();

    await verifyAndJoin(server);

    expect(launchGame).toHaveBeenCalledOnce();
    expect(launchGame).toHaveBeenCalledWith(server.addr, server.game_port, {
      profileName: "Survivor",
      dayzPath: "/dayz",
      launchParams: ["-noSplash"],
      mainMenu: undefined,
    });
    expect(useLaunchStore.getState().op?.phase).toBe("starting");
    expect(useServerStore.getState().downloadsActive).toBe(false);
  });

  it("subscribes the missing mods, waits for them, then launches", async () => {
    verifyServerMods.mockResolvedValue({
      mods: [
        { workshop_id: "1001", name: "Community Framework" },
        { workshop_id: "2002", name: "Armor Pack" },
      ],
      refreshed: [],
      checked_workshop: true,
    });
    steamModStates
      .mockResolvedValueOnce([
        { workshop_id: "1001", state: "not_subscribed" },
        { workshop_id: "2002", state: "not_subscribed" },
      ])
      .mockResolvedValueOnce([
        { workshop_id: "1001", state: "downloading" },
        { workshop_id: "2002", state: "ready" },
      ])
      .mockResolvedValue([
        { workshop_id: "1001", state: "ready" },
        { workshop_id: "2002", state: "ready" },
      ]);
    steamDownloadProgress.mockResolvedValue([
      { workshop_id: "1001", downloaded: "10", total: "100" },
    ]);
    renderActions();

    const pending = verifyAndJoin(server);
    await vi.advanceTimersByTimeAsync(0);
    expect(launchGame).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    expect(steamSubscribeMods).toHaveBeenCalledWith(["1001", "2002"]);
    expect(launchGame).toHaveBeenCalledOnce();
  });

  it("stops with a notice when subscribing fails", async () => {
    declareMods({ workshop_id: "1001", name: "Community Framework" });
    steamModStates.mockResolvedValue([{ workshop_id: "1001", state: "not_subscribed" }]);
    steamSubscribeMods.mockResolvedValue({ succeeded: 0, failures: [["1001", "no licence"]] });
    renderActions();

    await verifyAndJoin(server);

    expect(launchGame).not.toHaveBeenCalled();
    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "code", code: "E01", extra: "1 of 1 — no licence" },
    });
  });

  it("flags an unchecked Workshop read but still launches", async () => {
    verifyServerMods.mockResolvedValue({ mods: [], refreshed: [], checked_workshop: false });
    renderActions();

    await verifyAndJoin(server);

    expect(launchGame).toHaveBeenCalledOnce();
    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "code", code: "W01" },
    });
  });

  it("gives up with a notice when a download stalls for three minutes", async () => {
    declareMods({ workshop_id: "1001", name: "Community Framework" });
    stuckDownloading("1001");
    renderActions();

    const pending = verifyAndJoin(server);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(useLaunchStore.getState().notice).toBeNull();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await pending;

    expect(launchGame).not.toHaveBeenCalled();
    expect(useLaunchStore.getState().op).toBeNull();
    expect(useServerStore.getState().downloadsActive).toBe(false);
    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "code", code: "W02" },
    });
  });

  it("stops without launching when the wait is cancelled", async () => {
    declareMods({ workshop_id: "1001", name: "Community Framework" });
    stuckDownloading("1001");
    renderActions();

    const pending = verifyAndJoin(server);
    await vi.advanceTimersByTimeAsync(0);
    cancelWait();
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    expect(launchGame).not.toHaveBeenCalled();
    expect(useServerStore.getState().downloadsActive).toBe(false);
    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "code", code: "W04" },
    });
  });

  it("does not wait on mods that are not on the Workshop", async () => {
    declareMods({ workshop_id: "1001", name: "Local mod" });
    steamModStates.mockResolvedValue([{ workshop_id: "1001", state: "not_on_workshop" }]);
    renderActions();

    await verifyAndJoin(server);

    expect(steamSubscribeMods).not.toHaveBeenCalled();
    expect(launchGame).toHaveBeenCalledOnce();
  });

  it("turns a program error during the mod check into a plain notice", async () => {
    verifyServerMods.mockRejectedValue(new TypeError("Cannot read properties of null"));
    renderActions();

    await verifyAndJoin(server);

    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "plain", text: "Could not check this server's mods. The launcher log has the details." },
    });
  });

  it("records the raw error when the launch itself fails", async () => {
    launchGame.mockRejectedValue(new Error("boom"));
    renderActions();

    await verifyAndJoin(server);

    expect(useLaunchStore.getState().result).toEqual({
      addr: server.addr,
      error: "Error: boom",
    });
    expect(useLaunchStore.getState().op).toBeNull();
    expect(useServerStore.getState().downloadsActive).toBe(false);
  });

  it("waits out the settle time after forcing an update before launching", async () => {
    verifyServerMods.mockResolvedValue({
      mods: [{ workshop_id: "1001", name: "Community Framework" }],
      refreshed: ["1001"],
      checked_workshop: true,
    });
    steamModStates.mockResolvedValue([{ workshop_id: "1001", state: "ready" }]);
    renderActions();

    const pending = verifyAndJoin(server);
    await vi.advanceTimersByTimeAsync(3000);
    expect(launchGame).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    await pending;

    expect(launchGame).toHaveBeenCalledOnce();
  });
});
