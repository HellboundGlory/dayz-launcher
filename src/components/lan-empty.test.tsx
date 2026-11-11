import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as LanModule from "@/stores/lan-store";
import { useLanStore } from "@/stores/lan-store";
import { LanEmpty } from "./lan-empty";

// SSR takes zustand's initial snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/lan-store", async (importOriginal) => {
  const actual = await importOriginal<typeof LanModule>();
  return { ...actual, useLanStore: liveHook(actual.useLanStore) };
});

const { scan } = vi.hoisted(() => ({ scan: vi.fn(async () => {}) }));
const captured = vi.hoisted(() => ({ button: null as Record<string, unknown> | null }));

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (props?.["data-part"] === "again") captured.button = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

beforeEach(() => {
  scan.mockClear();
  captured.button = null;
  useLanStore.setState({ state: "idle", addrs: [], scan });
});

describe("LanEmpty", () => {
  it("says it is looking while a scan runs, with no button", () => {
    useLanStore.setState({ state: "scanning" });
    const html = renderToStaticMarkup(<LanEmpty />);

    expect(html).toContain("Looking on your network");
    expect(html).not.toContain('data-part="again"');
  });

  it("shows the approved empty text and looks again on press", () => {
    useLanStore.setState({ state: "done", addrs: [] });
    const html = renderToStaticMarkup(<LanEmpty />);

    expect(html).toContain("No servers on your network");
    expect(html).toContain("A server on another subnet or behind a VPN won&#x27;t show up here");
    expect(html).toContain("Look again");

    (captured.button?.onClick as () => void)();
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("reports a failed scan and offers the same button", () => {
    useLanStore.setState({ state: "failed" });
    const html = renderToStaticMarkup(<LanEmpty />);

    expect(html).toContain("Could not look on the network.");
    expect(html).toContain("Look again");
  });
});
