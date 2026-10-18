import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RegistryStatus } from "@/lib/tauri";
import { whenRegistryReady } from "./registry-ready";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("whenRegistryReady", () => {
  it("resolves at once when the registry is already open", async () => {
    vi.mocked(invoke).mockResolvedValue({ degraded: false });
    vi.mocked(listen).mockResolvedValue(() => {});

    await expect(whenRegistryReady()).resolves.toEqual({ degraded: false });
  });

  it("waits for the registry-ready event when the registry is not open yet", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    let emitReady: (payload: RegistryStatus) => void = () => {};
    vi.mocked(listen).mockImplementation(async (_name, handler) => {
      emitReady = (payload) => handler({ event: "registry-ready", id: 0, payload });
      return () => {};
    });

    const ready = whenRegistryReady();
    emitReady({ degraded: true });

    await expect(ready).resolves.toEqual({ degraded: true });
  });
});
