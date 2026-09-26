import { describe, it, expect, beforeEach } from "vitest";
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

  it("begin() clears the notice, like it clears the result", () => {
    useLaunchStore.getState().setNotice("1.2.3.4:2302", { kind: "plain", text: "hi" });

    useLaunchStore.getState().begin("5.6.7.8:2302", "Other Server");

    expect(useLaunchStore.getState().notice).toBeNull();
  });
});
