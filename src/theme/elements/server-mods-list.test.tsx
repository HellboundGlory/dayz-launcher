import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerModsList, ServerModsListHost, loadServerMods, resolveModsListDisplay } from "./list-elements";
import { ElementContextProvider, SubjectContextProvider } from "./context";
import { PopupContextProvider } from "./popup-elements";
import { getNeutralLayout } from "../neutral";
import { setCachedReadiness } from "@/stores/readiness-store";
import type { ModReadinessEntry, Server, ServerModReadiness } from "@/types/server";

vi.mock("@/lib/tauri", () => ({
  serverModReadiness: vi.fn(),
}));

import { serverModReadiness } from "@/lib/tauri";

const moddedServer: Pick<Server, "addr" | "query_port" | "modded"> = {
  addr: "127.0.0.1",
  query_port: 27016,
  modded: true,
};

const oneMod: ModReadinessEntry = {
  workshop_id: "111",
  name: "CF",
  state: "ready",
  size_bytes: null,
  size_is_upper_bound: false,
  preview_url: null,
  is_unique: false,
  downloaded_bytes: null,
  total_bytes: null,
};

describe("ServerModsList rendering", () => {
  it("omits the header when the list is configured without one", () => {
    const html = renderToStaticMarkup(<ServerModsList header={false} state={undefined} mods={[oneMod]} modded />);
    expect(html).not.toContain('data-part="header"');
    expect(html).toContain('data-part="rows"');
  });

  it.each([
    { modded: true, text: "No mods found or not probed yet." },
    { modded: false, text: "No mods required." },
  ])("renders the empty text for a modded=$modded server with no mods, never invented rows", ({ modded, text }) => {
    const html = renderToStaticMarkup(<ServerModsList state="empty" mods={[]} modded={modded} />);
    expect(html).toContain(text);
    expect(html).not.toContain("CF");
    expect(html).not.toContain("Community Online Tools");
    expect(html).not.toContain("DayZ-Expansion-Bundle");
  });

  it("renders only the mods actually returned", () => {
    const html = renderToStaticMarkup(
      <ServerModsList
        state={undefined}
        mods={[oneMod]}
        modded
        listLayout={getNeutralLayout("layout/lists/serverMods.json")}
      />,
    );
    expect(html).toContain('data-part="rows"');
    expect(html).not.toContain('data-part="empty"');
    expect(html).toContain("CF");
  });

  it("renders the loading state without any rows", () => {
    const html = renderToStaticMarkup(<ServerModsList state="loading" mods={[]} modded />);
    expect(html).toContain('data-part="loading"');
    expect(html).toContain("Checking mod readiness…");
    expect(html).not.toContain('data-part="rows"');
  });
});

describe("ServerModsListHost", () => {
  const serverA = { ...moddedServer, addr: "10.0.0.1", query_port: 27017 } as Server;
  const serverB = { ...moddedServer, addr: "10.0.0.2", query_port: 27018 } as Server;

  it("lists the mods of the server it is drawn for, not the selected one", () => {
    setCachedReadiness(serverB.addr, serverB.query_port, { stale: false, mods: [oneMod] });
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ selectedServer: serverA }}>
        <SubjectContextProvider subject={{ kind: "server", data: serverB }} contextName="modal">
          <ServerModsListHost />
        </SubjectContextProvider>
      </ElementContextProvider>,
    );
    expect(html).toContain("CF");
  });

  it("reads readiness inside a popup opened from a row, but not in the row itself", () => {
    setCachedReadiness(serverB.addr, serverB.query_port, { stale: false, mods: [oneMod] });
    const inRow = (children: React.ReactNode) => (
      <SubjectContextProvider subject={{ kind: "server", data: serverB }} contextName="row">
        {children}
      </SubjectContextProvider>
    );
    expect(renderToStaticMarkup(inRow(<ServerModsListHost />))).not.toContain("CF");
    const popup = renderToStaticMarkup(
      inRow(
        <PopupContextProvider popupId="serverActions" close={() => {}}>
          <ServerModsListHost />
        </PopupContextProvider>,
      ),
    );
    expect(popup).toContain("CF");
  });
});

describe("loadServerMods", () => {
  it("resolves to empty without fetching for an unmodded server, and for one that declares no mods", async () => {
    expect(await loadServerMods({ ...moddedServer, modded: false })).toEqual({ state: "empty", mods: [] });
    expect(serverModReadiness).not.toHaveBeenCalled();

    vi.mocked(serverModReadiness).mockResolvedValueOnce({ stale: false, mods: [] });
    expect(await loadServerMods(moddedServer)).toEqual({ state: "empty", mods: [] });
  });

  it("surfaces a rejected fetch as stale, never as invented mods", async () => {
    vi.mocked(serverModReadiness).mockRejectedValueOnce(new Error("network error"));
    const result = await loadServerMods(moddedServer);
    expect(result.state).toBe("stale");
    expect(result.mods).toEqual([]);
  });
});

describe("resolveModsListDisplay", () => {
  const readyModded: Pick<Server, "modded"> = { modded: true };
  const readinessWithMods: ServerModReadiness = { stale: false, mods: [oneMod] };
  const readinessEmpty: ServerModReadiness = { stale: false, mods: [] };
  const readinessStale: ServerModReadiness = { stale: true, mods: [oneMod] };

  it.each([
    {
      case: "no selected server",
      server: null,
      loading: false,
      readiness: null,
      lastMods: [oneMod],
      expected: { state: "empty", mods: [] },
    },
    {
      case: "an unmodded server",
      server: { modded: false },
      loading: false,
      readiness: null,
      lastMods: [oneMod],
      expected: { state: "empty", mods: [] },
    },
    {
      case: "a loading fetch",
      server: readyModded,
      loading: true,
      readiness: null,
      lastMods: [oneMod],
      expected: { state: "loading", mods: [] },
    },
    {
      case: "a failed fetch",
      server: readyModded,
      loading: false,
      readiness: null,
      lastMods: [oneMod],
      expected: { state: "stale", mods: [oneMod] },
    },
    {
      case: "a stale readiness",
      server: readyModded,
      loading: false,
      readiness: readinessStale,
      lastMods: [oneMod],
      expected: { state: "stale", mods: [oneMod] },
    },
    {
      case: "a resolved readiness with mods",
      server: readyModded,
      loading: false,
      readiness: readinessWithMods,
      lastMods: [],
      expected: { state: undefined, mods: [oneMod] },
    },
    {
      case: "a resolved readiness with no mods",
      server: readyModded,
      loading: false,
      readiness: readinessEmpty,
      lastMods: [oneMod],
      expected: { state: "empty", mods: [] },
    },
  ])("maps $case", ({ server, loading, readiness, lastMods, expected }) => {
    expect(resolveModsListDisplay(server, loading, readiness, lastMods)).toEqual(expected);
  });
});
