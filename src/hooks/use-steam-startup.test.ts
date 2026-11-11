import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useSteamStartup } from "./use-steam-startup";

const { discoverServers, whenRegistryReady } = vi.hoisted(() => ({
  discoverServers: vi.fn(async () => {}),
  whenRegistryReady: vi.fn<() => Promise<{ degraded: boolean }>>(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, discoverServers, logClient: vi.fn(async () => {}) };
});

vi.mock("@/lib/registry-ready", () => ({ whenRegistryReady }));

/** Renders the hook and hands back the first-load function it returns. */
function startup() {
  let runInitialLoad: (() => Promise<void>) | null = null;
  const Probe = () => {
    runInitialLoad = useSteamStartup({ registryOpen: false, setRefreshedAt: vi.fn() })
      .runInitialLoad;
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  return runInitialLoad!;
}

describe("the startup load", () => {
  it("does not ask for servers until the registry is open", async () => {
    let openRegistry: (status: { degraded: boolean }) => void = () => {};
    whenRegistryReady.mockReturnValue(
      new Promise((resolve) => {
        openRegistry = resolve;
      }),
    );
    discoverServers.mockClear();

    const load = startup()();
    await Promise.resolve();
    expect(discoverServers).not.toHaveBeenCalled();

    openRegistry({ degraded: false });
    await load;
    expect(discoverServers).toHaveBeenCalledTimes(1);
  });
});
