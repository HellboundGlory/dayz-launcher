import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLaunchStore } from "@/stores/launch-store";

beforeEach(() => {
  useLaunchStore.setState({ op: null, result: null, notice: null, dayzRunning: false });
});

describe("notice", () => {
  it("setNotice stores the addr alongside the notice", () => {
    useLaunchStore.getState().setNotice("1.2.3.4:2302", { kind: "plain", text: "hi" });

    expect(useLaunchStore.getState().notice).toEqual({
      addr: "1.2.3.4:2302",
      notice: { kind: "plain", text: "hi" },
    });
  });

  it("clears a success notice after two seconds, unless another notice replaced it", () => {
    vi.useFakeTimers();
    const { setNotice } = useLaunchStore.getState();
    setNotice("1.2.3.4:2302", { kind: "plain", text: "Address copied", tone: "success" });
    vi.advanceTimersByTime(1999);
    expect(useLaunchStore.getState().notice).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useLaunchStore.getState().notice).toBeNull();

    setNotice("1.2.3.4:2302", { kind: "plain", text: "Address copied", tone: "success" });
    setNotice("1.2.3.4:2302", { kind: "code", code: "E01" });
    vi.advanceTimersByTime(2000);
    expect(useLaunchStore.getState().notice?.notice).toEqual({ kind: "code", code: "E01" });
    vi.useRealTimers();
  });

  it("begin() clears the notice, like it clears the result", () => {
    useLaunchStore.getState().setNotice("1.2.3.4:2302", { kind: "plain", text: "hi" });

    useLaunchStore.getState().begin("5.6.7.8:2302", "Other Server");

    expect(useLaunchStore.getState().notice).toBeNull();
  });
});

describe("begin", () => {
  it("cancels the previous operation before installing the new one", () => {
    const first = useLaunchStore.getState().begin("1.2.3.4:2302", "First Server");

    const second = useLaunchStore.getState().begin("5.6.7.8:2302", "Second Server");

    expect(first.cancelled).toBe(true);
    expect(second.cancelled).toBe(false);
  });
});
