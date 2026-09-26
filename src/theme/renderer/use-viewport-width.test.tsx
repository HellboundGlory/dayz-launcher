import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readViewportWidth, subscribeViewportWidth, useViewportWidth } from "./use-viewport-width";

interface FakeWindow {
  innerWidth: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

function stubWindow(innerWidth: number): FakeWindow {
  const fake: FakeWindow = {
    innerWidth,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  vi.stubGlobal("window", fake);
  return fake;
}

function fireResize(fake: FakeWindow) {
  const calls = fake.addEventListener.mock.calls.filter(([type]) => type === "resize");
  for (const [, handler] of calls) (handler as () => void)();
}

function Probe() {
  return <span>{useViewportWidth()}</span>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useViewportWidth", () => {
  it("reads the inner width of the window it renders in", () => {
    stubWindow(1154);
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>1154</span>");
  });

  it("is zero where there is no window, so a variant file still renders", () => {
    expect(readViewportWidth()).toBe(0);
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>0</span>");
  });
});

describe("subscribeViewportWidth", () => {
  it("reports a width once per settled resize, not once per resize event", () => {
    vi.useFakeTimers();
    const fake = stubWindow(975);
    const onChange = vi.fn();

    const unsubscribe = subscribeViewportWidth(onChange);
    fake.innerWidth = 1154;
    fireResize(fake);
    vi.advanceTimersByTime(99);
    expect(onChange).not.toHaveBeenCalled();

    fake.innerWidth = 1400;
    fireResize(fake);
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readViewportWidth()).toBe(1400);

    unsubscribe();
  });

  it("stops listening and drops a pending report on unsubscribe", () => {
    vi.useFakeTimers();
    const fake = stubWindow(1400);
    const onChange = vi.fn();

    const unsubscribe = subscribeViewportWidth(onChange);
    fireResize(fake);
    unsubscribe();

    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    expect(fake.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  it("unsubscribes to nothing without a window", () => {
    const unsubscribe = subscribeViewportWidth(() => {});
    expect(unsubscribe()).toBeUndefined();
  });
});
