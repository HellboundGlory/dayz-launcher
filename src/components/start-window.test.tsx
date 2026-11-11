import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as LaunchModule from "@/stores/launch-store";
import type * as StartWindowModule from "@/stores/start-window-store";
import { useLaunchStore, type OpPhase } from "@/stores/launch-store";
import { useStartWindowStore } from "@/stores/start-window-store";
import { useConfirmStore } from "@/stores/confirm-store";
import { handleEscape, openEscapeLayer } from "@/theme/interaction/escape-layers";
import { StartWindow } from "./start-window";

// SSR takes zustand's initial snapshot, so route both hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/launch-store", async (importOriginal) => {
  const actual = await importOriginal<typeof LaunchModule>();
  return { ...actual, useLaunchStore: liveHook(actual.useLaunchStore) };
});

vi.mock("@/stores/start-window-store", async (importOriginal) => {
  const actual = await importOriginal<typeof StartWindowModule>();
  return { ...actual, useStartWindowStore: liveHook(actual.useStartWindowStore) };
});

vi.mock("@/stores/confirm-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/confirm-store")>();
  return { ...actual, useConfirmStore: liveHook(actual.useConfirmStore) };
});

const { cancelWait } = vi.hoisted(() => ({ cancelWait: vi.fn() }));

vi.mock("@/hooks/use-server-actions", () => ({
  useServerActions: () => ({ cancelWait }),
}));

// Effects never run under SSR, so record what the window hands the Escape layer.
const escapeLayer = vi.hoisted(() => ({
  active: null as boolean | null,
  close: null as (() => void) | null,
}));

vi.mock("@/theme/interaction/escape-layers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/theme/interaction/escape-layers")>();
  return {
    ...actual,
    useEscapeLayer: (active: boolean, close: () => void) => {
      escapeLayer.active = active;
      escapeLayer.close = close;
      return actual.useEscapeLayer(active, close);
    },
  };
});

// Captures props by data-part since renderToStaticMarkup drops event handlers.
const captured: Record<string, Record<string, unknown>[]> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") (captured[part] ??= []).push(props);
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const SLOW_TEXT =
  "This is taking longer than usual. The first start after a DayZ update can take a few minutes. Nothing is stuck while the time keeps counting.";

function beginOp(phase: OpPhase, note: string | null = null) {
  const cancel = useLaunchStore.getState().begin("1.2.3.4:27016", "Some Server");
  useLaunchStore.getState().setPhase(phase, note);
  useStartWindowStore.getState().show(cancel, false, false);
  return cancel;
}

function render() {
  return renderToStaticMarkup(<StartWindow />);
}

const rows = () => captured["step"] ?? [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  useLaunchStore.setState({ op: null, dayzRunning: false });
  useStartWindowStore.getState().close();
  useConfirmStore.setState({ request: null });
  escapeLayer.active = null;
  escapeLayer.close = null;
  cancelWait.mockReset();
  for (const key of Object.keys(captured)) delete captured[key];
});

afterEach(() => {
  vi.useRealTimers();
  useLaunchStore.setState({ op: null, dayzRunning: false });
  useStartWindowStore.getState().close();
});

describe("StartWindow", () => {
  it("renders nothing until a join opens it", () => {
    expect(render()).toBe("");

    const other = useLaunchStore.getState().begin("1.2.3.4:27016", "Some Server");
    useStartWindowStore.getState().show({ cancelled: false }, false, false);
    expect(render()).toBe("");

    useStartWindowStore.getState().show(other, false, false);
    expect(render()).not.toBe("");
  });

  it("stays out of the way once Hide was pressed", () => {
    beginOp("verifying", "VERIFYING…");
    useStartWindowStore.getState().hide();

    expect(render()).toBe("");
  });

  it("stands down once DayZ is running", () => {
    beginOp("starting");
    useLaunchStore.setState({ dayzRunning: true });

    expect(render()).toBe("");
  });

  it("steps aside while a question about the join is open", () => {
    beginOp("verifying", "VERIFYING…");
    useConfirmStore.setState({ request: { title: "Mods differ", message: "", confirmLabel: "Fix", action: () => {} } });

    expect(render()).toBe("");
    useConfirmStore.setState({ request: null });
    expect(render()).not.toBe("");
  });

  it("titles itself with the server and lists the steps of the join", () => {
    beginOp("downloading", "3 LEFT · 1.2 GB / 4.0 GB");
    const html = render();

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Starting DayZ");
    expect(html).toContain("Some Server");
    expect(captured["steps"]).toHaveLength(1);
    expect(rows().map((row) => row["data-state"])).toEqual(["done", "now", "todo", "todo"]);
    expect(rows()[1]["aria-current"]).toBe("step");
    expect(html).toContain("3 LEFT · 1.2 GB / 4.0 GB");
  });

  it("will not cancel once DayZ is being started", () => {
    beginOp("downloading", "WAITING ON 2…");
    render();
    expect(captured["cancel"][captured["cancel"].length - 1]?.disabled).toBe(false);

    useLaunchStore.getState().setPhase("launching");
    render();
    expect(captured["cancel"][captured["cancel"].length - 1]?.disabled).toBe(true);
  });

  it("keeps the slow note back at 59 s on a step and adds it at a minute", () => {
    beginOp("verifying", "VERIFYING…");

    vi.setSystemTime(59_000);
    expect(render()).not.toContain(SLOW_TEXT);

    vi.setSystemTime(60_000);
    expect(render()).toContain(SLOW_TEXT);
  });

  it("counts the current step's time in minutes and seconds beside it", () => {
    beginOp("verifying", "VERIFYING…");

    vi.setSystemTime(61_500);
    expect(render()).toContain("1:01");
  });

  it("keeps the slow note away while the download note is still moving", () => {
    beginOp("downloading", "2 LEFT · 100 MB / 400 MB");
    useStartWindowStore.getState().noteStep(1, 50_000, "1 LEFT · 200 MB / 400 MB");

    vi.setSystemTime(100_000);
    expect(render()).not.toContain(SLOW_TEXT);
  });

  it("closes itself on Escape", () => {
    beginOp("verifying", "VERIFYING…");
    render();

    expect(escapeLayer.active).toBe(true);
    const close = openEscapeLayer(escapeLayer.close!);
    handleEscape({ key: "Escape", preventDefault() {} });
    close();

    expect(useStartWindowStore.getState().hidden).toBe(true);
  });

  it("abandons the wait from Cancel", () => {
    beginOp("downloading", "WAITING ON 2…");
    render();

    (captured["cancel"][captured["cancel"].length - 1]?.onClick as () => void)();

    expect(cancelWait).toHaveBeenCalledOnce();
  });
});
