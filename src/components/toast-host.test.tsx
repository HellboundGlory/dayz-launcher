import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LaunchResult, Notice, ServerNotice } from "@/stores/launch-store";
import type { Server } from "@/types/server";
import { useModsStore } from "@/stores/mods-store";
import { useToastStore, type Toast } from "@/stores/toast-store";
import { ElementContextProvider, type ElementContextValue } from "@/theme/elements/context";
import { useNoticeToasts } from "@/theme/elements/notice-toasts";
import { ToastHost } from "./toast-host";

// SSR takes zustand's initial snapshot, so route every hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/toast-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/toast-store")>();
  return { ...actual, useToastStore: liveHook(actual.useToastStore) };
});

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

const launchState = {
  notice: null as ServerNotice | null,
  result: null as LaunchResult | null,
  setNotice: vi.fn<(addr: string, notice: Notice | null) => void>(),
  setResult: vi.fn<(result: LaunchResult | null) => void>(),
};

vi.mock("@/stores/launch-store", () => ({
  useLaunchStore: Object.assign((selector: (s: unknown) => unknown) => selector(launchState), {
    getState: () => launchState,
  }),
}));

const serverState = { servers: [] as Server[], selectedServer: null as Server | null };

vi.mock("@/stores/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/server-store")>();
  return { ...actual, useServerStore: (selector: (s: unknown) => unknown) => selector(serverState) };
});

/** Whether a drawn stack holds any cards; the host's own live region is always there. */
const cards = (html: string) => html.includes('data-part="toast"');

// Captures props by data-part since renderToStaticMarkup drops event handlers.
interface JsxProps {
  [key: string]: unknown;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  children?: unknown;
  style?: Record<string, unknown>;
}

const captured = vi.hoisted(() => ({
  parts: {} as Record<string, JsxProps[]>,
  host: null as JsxProps | null,
}));

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") (captured.parts[part] ??= []).push(props);
      if (props?.["data-toast-host"] === true) captured.host = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const server: Server = {
  addr: "192.168.1.1",
  game_port: 2302,
  query_port: 27016,
  name: "DayZ Epoch Test",
  map_display: "Chernarus",
  players: 42,
  max_players: 60,
  ping: 35,
  locked: false,
  vac: true,
  version: "1.26",
  in_game_time: "14:30",
  queue: null,
  day_multiplier: 1,
  night_multiplier: 1,
  mod_count: 5,
  country_code: "US",
  last_played: 1700000000,
  favourite: true,
  official: false,
  modded: true,
  first_person: false,
  battleye: true,
  online: true,
};

/** The host feeds the store from an effect, which SSR never runs; this does the same feed. */
function Sources() {
  useToastStore.getState().setNoticeToasts(useNoticeToasts());
  return null;
}

/** Draws the stack over whatever the notices currently say. */
function draw(context: Partial<ElementContextValue> = {}) {
  return renderToStaticMarkup(
    <ElementContextProvider value={context}>
      <Sources />
      <ToastHost />
    </ElementContextProvider>,
  );
}

const pushedToast = (overrides: Partial<Toast>): Toast => ({
  key: "t",
  tone: "info",
  tag: "Done",
  message: "Something happened.",
  ...overrides,
});

function resetToasts() {
  vi.clearAllTimers();
  useToastStore.setState({ entries: [], closed: [], hidden: [], paused: false, produced: [] });
  for (const key of Object.keys(captured.parts)) delete captured.parts[key];
  captured.host = null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  launchState.notice = null;
  launchState.result = null;
  launchState.setNotice.mockClear();
  launchState.setResult.mockClear();
  serverState.servers = [];
  serverState.selectedServer = null;
  useModsStore.setState({
    error: null,
    fromCache: false,
    verifyResult: null,
    mutationFailures: null,
    uniqueResult: null,
    rows: [],
    op: null,
  });
  resetToasts();
});

afterEach(() => {
  resetToasts();
  vi.useRealTimers();
});

describe("ToastHost", () => {
  it("draws no cards until a message arrives", () => {
    expect(cards(draw())).toBe(false);
    expect(draw()).toContain('aria-label="Notifications"');
  });

  it("closes a quick toast after five seconds and runs its onClose", () => {
    useToastStore.getState().showToast(pushedToast({ key: "done", tone: "success", quick: true }));
    const onClose = vi.fn();
    useToastStore.getState().showToast(pushedToast({ key: "later", quick: true, onClose }));

    vi.advanceTimersByTime(4999);
    expect(draw()).toContain("Something happened.");

    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(cards(draw())).toBe(false);
  });

  it("holds a quick toast's clock while the pointer is over the stack", () => {
    useToastStore.getState().showToast(pushedToast({ quick: true }));
    draw();

    captured.host!.onPointerEnter!();
    vi.advanceTimersByTime(20_000);
    expect(draw()).toContain("Something happened.");

    captured.host!.onPointerLeave!();
    vi.advanceTimersByTime(4800);
    expect(draw()).toContain("Something happened.");
    vi.advanceTimersByTime(200);
    expect(cards(draw())).toBe(false);
  });

  it("pauses the life bar while focus is inside", () => {
    useToastStore.getState().showToast(pushedToast({ quick: true }));
    draw();

    captured.host!.onFocus!();
    draw();
    expect(captured.parts["life"]?.slice(-1)[0]?.style).toMatchObject({ animationPlayState: "paused" });
  });

  it("keeps a sticky toast until its source clears", () => {
    useModsStore.setState({ error: "Steam refused." });
    expect(draw()).toContain("Steam refused.");

    vi.advanceTimersByTime(60_000);
    expect(draw()).toContain("Steam refused.");

    useModsStore.setState({ error: null });
    expect(cards(draw())).toBe(false);
  });

  it("shows a quick toast again when the same message comes back after it faded", () => {
    serverState.servers = [server];
    const copied = {
      addr: server.addr,
      notice: { kind: "plain" as const, text: "Address copied", tone: "success" as const },
    };
    launchState.notice = copied;
    expect(draw()).toContain("Address copied");

    // The launcher's own two-second clear lands before the toast's five seconds.
    launchState.notice = null;
    draw();
    vi.advanceTimersByTime(5000);
    expect(cards(draw())).toBe(false);

    launchState.notice = copied;
    expect(draw()).toContain("Address copied");
  });

  it("keeps a closed toast hidden until its source clears and returns", () => {
    useModsStore.setState({ error: "Steam refused." });
    draw();
    (captured.parts["close"]?.slice(-1)[0]?.onClick as () => void)();

    expect(cards(draw())).toBe(false);
    // Still produced, so the close stands.
    expect(cards(draw())).toBe(false);

    useModsStore.setState({ error: null });
    draw();
    useModsStore.setState({ error: "Steam refused." });
    expect(draw()).toContain("Steam refused.");
  });

  it("pushes out the oldest quick toast when a fifth arrives", () => {
    const oldestClose = vi.fn();
    for (const [key, message] of [
      ["two", "Two"],
      ["three", "Three"],
      ["four", "Four"],
    ]) {
      useToastStore.getState().showToast(pushedToast({ key, message }));
    }
    useToastStore.getState().showToast(pushedToast({ key: "old", message: "Oldest quick", quick: true, onClose: oldestClose }));
    // Newest last out of the four, so the quick one is still among them.
    expect(draw()).toContain("Oldest quick");

    useToastStore.getState().showToast(pushedToast({ key: "five", message: "Five" }));
    const html = draw();
    expect(html).toContain("Five");
    expect(html).toContain("Two");
    expect(oldestClose).toHaveBeenCalledTimes(1);
  });

  it("never hides or closes the storage toast", () => {
    const html = draw({ storageDegraded: true });
    expect(html).toContain("could not be opened");
    expect(html).toContain('data-state="error"');
    expect(captured.parts["close"]).toBeUndefined();

    for (const message of ["Two", "Three", "Four", "Five"]) {
      useToastStore.getState().showToast(pushedToast({ key: message, message }));
    }
    expect(draw({ storageDegraded: true })).toContain("could not be opened");
  });

  it("opens the update modal from Update and hides the toast from Later", () => {
    const dismissUpdateBanner = vi.fn();
    const openUpdateModal = vi.fn();
    const context = { updateAvailable: { version: "2.7.0" }, dismissUpdateBanner, openUpdateModal };

    expect(draw(context)).toContain("Tetra Launcher v2.7.0");
    expect(draw(context)).toContain("is ready to install.");

    const actions = captured.parts["actions"]?.slice(-1)[0]?.children as unknown as {
      props: { onClick: () => void; children: string };
    }[];

    expect(actions.map((action) => action.props.children)).toEqual(["Update", "Later"]);

    actions[0].props.onClick();
    expect(openUpdateModal).toHaveBeenCalledTimes(1);
    expect(dismissUpdateBanner).toHaveBeenCalledTimes(1);

    dismissUpdateBanner.mockClear();
    openUpdateModal.mockClear();
    actions[1].props.onClick();
    expect(dismissUpdateBanner).toHaveBeenCalledTimes(1);
    expect(openUpdateModal).not.toHaveBeenCalled();
  });

  it("shows a refused launch as an alert naming the server", () => {
    serverState.servers = [server];
    launchState.result = { addr: server.addr, error: "DayZ is not installed" };
    const html = draw();

    expect(html).toContain('data-state="error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Launch refused");
    expect(html).toContain("DayZ Epoch Test");
    expect(html).toContain("DayZ is not installed");
  });

  it("leaves a newer line alone when an older quick copy fades", () => {
    serverState.servers = [server];
    launchState.notice = {
      addr: server.addr,
      notice: { kind: "plain", text: "Address copied", tone: "success" },
    };
    draw();

    vi.advanceTimersByTime(1000);
    launchState.notice = {
      addr: server.addr,
      notice: { kind: "plain", text: "Waiting for Steam.", tone: "success" },
    };
    draw();

    // The first line's five seconds end a second before the second line's.
    vi.advanceTimersByTime(4000);
    expect(draw()).toContain("Waiting for Steam.");
    expect(launchState.setNotice).not.toHaveBeenCalled();
  });

  it("clears the launch notice when a launch toast closes", () => {
    serverState.servers = [server];
    launchState.result = { addr: server.addr, error: "DayZ is not installed" };
    draw();

    (captured.parts["close"]?.slice(-1)[0]?.onClick as () => void)();

    expect(launchState.setNotice).toHaveBeenCalledWith(server.addr, null);
    expect(launchState.setResult).toHaveBeenCalledWith(null);
  });

  it("fades an action's success line on its own", () => {
    serverState.servers = [server];
    launchState.notice = {
      addr: server.addr,
      notice: { kind: "plain", text: "Address copied", tone: "success" },
    };
    const html = draw();

    expect(html).toContain("Address copied");
    expect(html).toContain('data-part="life"');

    vi.advanceTimersByTime(5000);
    expect(cards(draw())).toBe(false);
  });

  it("reports no successful launch", () => {
    serverState.servers = [server];
    launchState.result = { addr: server.addr, message: "Launched DayZ with 5 mods" };

    expect(cards(draw())).toBe(false);
  });

  it("joins a mod result into one line and keeps a failure open", () => {
    useModsStore.setState({ verifyResult: { checked: 10, outdated: 2, queued: 2 } });
    const verify = draw();
    expect(verify).toContain("10 checked · 2 outdated · 2 re-downloading");
    expect(verify).toContain('data-part="life"');

    // The success line lives out its five seconds; the failure is a state, so it stays.
    vi.advanceTimersByTime(5000);
    useModsStore.setState({ verifyResult: null, mutationFailures: [["1", "Steam refused"]] });
    const failed = draw();
    expect(failed).toContain("1 mod could not be removed: Steam refused");
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('data-part="life"');
  });

  it("offers Update all for outdated mods and disables it while updating", () => {
    useModsStore.setState({
      rows: [{ workshop_id: "1", state: "needs_update", removed: false }] as never,
    });
    expect(draw()).toContain("1 mod needs updating");
    expect(draw()).toContain("Update all");

    useModsStore.setState({ op: { kind: "update", note: "UPDATING 1…" } });
    expect(draw()).toContain("UPDATING 1…");
  });
});
