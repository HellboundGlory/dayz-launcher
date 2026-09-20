import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerActionNotice } from "./notice-elements";
import { ElementContextProvider, type ElementContextValue } from "./context";
import type { LaunchResult, Notice, ServerNotice } from "@/stores/launch-store";
import type { Server } from "@/types/server";

// The store is mocked rather than driven for real: `renderToStaticMarkup` takes
// zustand's server snapshot, which is always the store's initial state.
const storeState: { notice: ServerNotice | null; result: LaunchResult | null } = {
  notice: null,
  result: null,
};

vi.mock("@/stores/launch-store", () => ({
  useLaunchStore: (selector: (s: unknown) => unknown) => selector(storeState),
}));

const setNotice = (addr: string, notice: Notice) => {
  storeState.notice = { addr, notice };
};
const setResult = (result: LaunchResult) => {
  storeState.result = result;
};

const moddedServer: Server = {
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

const otherServer: Server = { ...moddedServer, addr: "10.0.0.1" };

const render = (value: Partial<ElementContextValue>) =>
  renderToStaticMarkup(
    <ElementContextProvider value={value}>
      <ServerActionNotice />
    </ElementContextProvider>,
  );

afterEach(() => {
  storeState.notice = null;
  storeState.result = null;
});

describe("ServerActionNotice", () => {
  it("renders nothing when there is no notice or result for this server", () => {
    const html = render({ contextName: "row", selectedServer: moddedServer });
    expect(html).toBe("");
  });

  it("renders a W-code notice for this server, in the compact row form", () => {
    setNotice(moddedServer.addr, { kind: "code", code: "W02" });
    const html = render({ contextName: "row", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).toContain('data-state="warning"');
    expect(html).toContain('data-part="title"');
    expect(html).toContain("Downloads stalled");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Allow downloads during gameplay");
    expect(html).not.toContain("p-3");
    expect(html).not.toContain("border");
  });

  it("renders an E-code notice with data-state=error, in the bordered panel form", () => {
    setNotice(moddedServer.addr, { kind: "code", code: "E01" });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Could not subscribe");
    expect(html).toContain("p-3");
  });

  it("renders nothing when the notice is tagged with a different server's addr", () => {
    setNotice(otherServer.addr, { kind: "code", code: "W02" });
    const html = render({ contextName: "row", selectedServer: moddedServer });
    expect(html).toBe("");
  });

  it("renders a launch-result message with data-state=success", () => {
    setResult({ addr: moddedServer.addr, message: "Launched." });
    const html = render({ contextName: "row", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).toContain('data-state="success"');
    expect(html).toContain("Launched.");
  });

  it("renders nothing for an unmodded server with no notice or result", () => {
    const unmodded: Server = { ...moddedServer, modded: false };
    const html = render({ contextName: "row", selectedServer: unmodded });
    expect(html).toBe("");
  });

  it("still renders a launch result for an unmodded server", () => {
    const unmodded: Server = { ...moddedServer, modded: false };
    setResult({ addr: unmodded.addr, error: "Failed to launch." });
    const html = render({ contextName: "row", selectedServer: unmodded });
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Failed to launch.");
  });
});
