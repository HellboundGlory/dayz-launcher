import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NoticeError,
  NoticeLaunch,
  NoticeModsCached,
  NoticeModsError,
  NoticeModsOutdated,
  NoticeModsResult,
  NoticeStorage,
  NoticeUpdate,
  ServerActionNotice,
} from "./notice-elements";
import { ElementContextProvider, type ElementContextValue } from "./context";
import type { LaunchResult, Notice, ServerNotice } from "@/stores/launch-store";
import type { Server } from "@/types/server";

function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

async function withModsStore<T>(overrides: Record<string, unknown>, fn: () => T): Promise<T> {
  const { useModsStore } = await import("@/stores/mods-store");
  const prior = useModsStore.getState();
  useModsStore.setState({ ...prior, ...overrides });
  try {
    return fn();
  } finally {
    useModsStore.setState(prior, true);
  }
}

// The store is mocked rather than driven for real: `renderToStaticMarkup` takes
// zustand's server snapshot, which is always the store's initial state.
const storeState: { notice: ServerNotice | null; result: LaunchResult | null } = {
  notice: null,
  result: null,
};

vi.mock("@/stores/launch-store", () => ({
  useLaunchStore: (selector: (s: unknown) => unknown) => selector(storeState),
}));

const serverState: { servers: Server[] } = { servers: [] };

vi.mock("@/stores/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/server-store")>();
  return { ...actual, useServerStore: (selector: (s: unknown) => unknown) => selector(serverState) };
});

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
  serverState.servers = [];
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
    expect(html).toContain('data-part="code"');
    expect(html).toContain("W02");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Downloads stalled");
    expect(html).toContain("Allow downloads during gameplay");
    expect(html).not.toContain("p-3");
    expect(html).not.toContain("border bg-surface2");
  });

  it("renders an E-code notice with data-state=error, in the bordered panel form", () => {
    setNotice(moddedServer.addr, { kind: "code", code: "E01" });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).toContain('data-state="error"');
    expect(html).toContain('data-part="code"');
    expect(html).toContain("E01");
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
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Launched.");
    expect(html).not.toContain('data-part="title"');
    expect(html).not.toContain('data-part="code"');
  });

  it("renders a launch refusal with a title and the full error message", () => {
    setResult({ addr: moddedServer.addr, error: "Steam refused to launch DayZ." });
    const html = render({ contextName: "row", selectedServer: moddedServer });
    expect(html).toContain('data-state="error refused"');
    expect(html).toContain('data-part="title"');
    expect(html).toContain("Launch refused");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Steam refused to launch DayZ.");
  });

  it("renders a plain notice with only a message part", () => {
    setNotice(moddedServer.addr, { kind: "plain", text: "Waiting for Steam." });
    const html = render({ contextName: "row", selectedServer: moddedServer });
    expect(html).toContain('data-state="warning"');
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Waiting for Steam.");
    expect(html).not.toContain('data-part="title"');
    expect(html).not.toContain('data-part="code"');
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
    expect(html).toContain('data-state="error refused"');
    expect(html).toContain("Launch refused");
    expect(html).toContain("Failed to launch.");
  });
});

describe("NoticeLaunch", () => {
  const renderBar = () => renderToStaticMarkup(<NoticeLaunch />);

  it("renders nothing with no notice or launch result", () => {
    expect(renderBar()).toBe("");
  });

  it("never reports a successful launch", () => {
    setResult({ addr: moddedServer.addr, message: "Launched DayZ with 5 mods" });
    expect(renderBar()).toBe("");
  });

  it("shows a join warning with its code and the server it belongs to", () => {
    serverState.servers = [moddedServer];
    setNotice(moddedServer.addr, { kind: "code", code: "W02" });
    const html = renderBar();
    expect(html).toContain('data-el="notice.launch"');
    expect(html).toContain('data-state="warning"');
    expect(html).toContain("W02");
    expect(html).toContain("DayZ Epoch Test");
    expect(html).toContain("Downloads stalled");
    expect(html).toContain('aria-live="polite"');
  });

  it("shows a refused launch as an alert, even for a server no longer listed", () => {
    setResult({ addr: otherServer.addr, error: "DayZ is not installed" });
    const html = renderBar();
    expect(html).toContain('data-state="error refused"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Launch refused");
    expect(html).toContain("DayZ is not installed");
    expect(html).not.toContain('data-part="server"');
  });
});

describe("NoticeUpdate", () => {
  it("renders title, message, update and later parts", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ updateAvailable: { version: "2.7.0" } }}>
        <NoticeUpdate />
      </ElementContextProvider>,
    );
    expect(html).toContain('data-part="title"');
    expect(html).toContain("Update available");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("2.7.0");
    expect(html).toContain('data-part="update"');
    expect(html).toContain('data-part="later"');
  });
});

describe("NoticeStorage", () => {
  it("renders a tag and message part", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ storageDegraded: true }}>
        <NoticeStorage />
      </ElementContextProvider>,
    );
    expect(html).toContain('data-part="tag"');
    expect(html).toContain("STORAGE");
    expect(html).toContain('data-part="message"');
  });
});

describe("NoticeError", () => {
  it("renders a tag, message and dismiss part", () => {
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ error: "Something broke." }}>
        <NoticeError />
      </ElementContextProvider>,
    );
    expect(html).toContain('data-part="tag"');
    expect(html).toContain("ERROR");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Something broke.");
    expect(html).toContain('data-part="dismiss"');
  });
});

describe("NoticeModsError", () => {
  it("renders nothing when the mods store has no error", async () => {
    const html = await withModsStore({ error: null }, () => renderToStaticMarkup(<NoticeModsError />));
    expect(html).toBe("");
  });

  it("renders the mods store's error message", async () => {
    const html = await withModsStore({ error: "Steam refused." }, () =>
      renderToStaticMarkup(<NoticeModsError />),
    );
    expect(html).toContain('data-el="notice.modsError"');
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Steam refused.");
  });
});

describe("NoticeModsCached", () => {
  it("renders nothing when not showing a cached list", async () => {
    const html = await withModsStore({ fromCache: false }, () =>
      renderToStaticMarkup(<NoticeModsCached />),
    );
    expect(html).toBe("");
  });

  it("renders the cached-list message", async () => {
    const html = await withModsStore({ fromCache: true }, () =>
      renderToStaticMarkup(<NoticeModsCached />),
    );
    expect(html).toContain('data-el="notice.modsCached"');
    expect(html).toContain("Steam unreachable — showing last known mod list");
  });
});

describe("NoticeModsOutdated", () => {
  it("renders nothing when nothing is outdated", async () => {
    const html = await withModsStore({ rows: [] }, () => renderToStaticMarkup(<NoticeModsOutdated />));
    expect(html).toBe("");
  });

  it("renders the outdated count and an updateAll part", async () => {
    const html = await withModsStore(
      {
        rows: [
          { workshop_id: "1", state: "needs_update", removed: false },
          { workshop_id: "2", state: "ready", removed: false },
        ],
      },
      () => renderToStaticMarkup(<NoticeModsOutdated />),
    );
    expect(html).toContain('data-el="notice.modsOutdated"');
    expect(html).toContain("1 mod needs updating");
    expect(html).toContain('data-part="updateAll"');
  });

  it("marks busy while an update op is running", async () => {
    const html = await withModsStore(
      {
        rows: [{ workshop_id: "1", state: "needs_update", removed: false }],
        op: { kind: "update", note: "UPDATING 1…" },
      },
      () => renderToStaticMarkup(<NoticeModsOutdated />),
    );
    expect(html).toContain('data-state="busy"');
    expect(html).toContain("UPDATING 1…");
  });
});

describe("NoticeModsResult", () => {
  it("renders nothing when there is no result to show", async () => {
    const html = await withModsStore(
      { verifyResult: null, mutationFailures: null, uniqueResult: null },
      () => renderToStaticMarkup(<NoticeModsResult />),
    );
    expect(html).toBe("");
  });

  it("renders the verify result with a success state", async () => {
    const html = await withModsStore(
      { verifyResult: { checked: 10, outdated: 2, queued: 2 } },
      () => renderToStaticMarkup(<NoticeModsResult />),
    );
    expect(html).toContain('data-state="success"');
    expect(html).toContain("10 checked");
    expect(html).toContain("2 outdated");
    expect(html).toContain("2 re-downloading");
    expect(html).toContain('data-part="dismiss"');
  });

  it("renders a failure state when a mutation failed", async () => {
    const html = await withModsStore(
      { mutationFailures: [["1", "Steam refused"]] },
      () => renderToStaticMarkup(<NoticeModsResult />),
    );
    expect(html).toContain('data-state="failure"');
    expect(html).toContain("could not be removed: Steam refused");
  });

  it("renders 'Removed ok' when unsubscribe/cleanup had no failures", async () => {
    const html = await withModsStore({ mutationFailures: [] }, () =>
      renderToStaticMarkup(<NoticeModsResult />),
    );
    expect(html).toContain('data-state="success"');
    expect(html).toContain("Removed ok");
  });
});
