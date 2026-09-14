import { describe, expect, it } from "vitest";
import { effectiveModState } from "./mods-tab.tsx";

describe("effectiveModState", () => {
  it("defaults to rowState when liveState is absent", () => {
    expect(effectiveModState("ready", undefined)).toBe("ready");
    expect(effectiveModState("needs_update", undefined)).toBe("needs_update");
  });

  it("prioritizes downloading over all states", () => {
    expect(effectiveModState("ready", "downloading")).toBe("downloading");
    expect(effectiveModState("needs_update", "downloading")).toBe("downloading");
  });

  it("never allows a cheap poll's 'ready' to downgrade 'needs_update'", () => {
    expect(effectiveModState("needs_update", "ready")).toBe("needs_update");
  });

  it("reflects uninstalled or unsubscribed live states even if row was needs_update", () => {
    expect(effectiveModState("needs_update", "not_installed")).toBe("not_installed");
    expect(effectiveModState("needs_update", "not_subscribed")).toBe("not_subscribed");
  });

  it("reflects liveState when row was ready", () => {
    expect(effectiveModState("ready", "ready")).toBe("ready");
    expect(effectiveModState("ready", "not_installed")).toBe("not_installed");
    expect(effectiveModState("ready", "needs_update")).toBe("needs_update");
  });
});
