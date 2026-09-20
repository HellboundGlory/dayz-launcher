import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerActionNotice } from "./notice-elements";
import { ElementContextProvider, type ElementContextValue } from "./context";
import type { Server } from "@/types/server";

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

const render = (value: Partial<ElementContextValue>) =>
  renderToStaticMarkup(
    <ElementContextProvider value={value}>
      <ServerActionNotice />
    </ElementContextProvider>,
  );

describe("ServerActionNotice", () => {
  it("renders the compact single-line form in a row context", () => {
    const html = render({ contextName: "row", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).not.toContain("p-3");
    expect(html).not.toContain("border");
  });

  it("renders the bordered panel form outside a row context", () => {
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).toContain("border-warn/70");
    expect(html).toContain("p-3");
  });
});
