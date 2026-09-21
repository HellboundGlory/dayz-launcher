import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Server } from "@/types/server";
import type { ModReadinessEntry, ServerModReadiness } from "@/types/server";
import { formatBytes, formatGameTime, gameTimeParts } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";
import { useRowProbeStore } from "./row-probe-store";
import { ElementContextProvider, type ElementContextValue } from "./context";
import {
  ServerAddress,
  ServerCancel,
  ServerDeselect,
  ServerFavourite,
  ServerGameTime,
  ServerLastPlayed,
  ServerLoadMenuPopup,
  ServerLoadToMenu,
  ServerManageMods,
  ServerMenu,
  ServerModCount,
  ServerName,
  ServerPing,
  ServerPlayers,
  ServerRefresh,
  ServerRegion,
  ServerTags,
  ServerVersion,
} from "./server-elements";

const server: Server = {
  addr: "192.168.1.1",
  game_port: 2302,
  query_port: 27016,
  name: "DayZ Test Server",
  map_display: "Chernarus",
  players: 5,
  max_players: 60,
  ping: 40,
  locked: false,
  vac: true,
  version: "1.25",
  in_game_time: "14:00",
  queue: null,
  day_multiplier: 1,
  night_multiplier: 1,
  mod_count: 3,
  country_code: "US",
  last_played: null,
  favourite: false,
  official: false,
  modded: true,
  first_person: false,
  battleye: true,
  online: true,
};

const otherServer: Server = { ...server, addr: "10.0.0.2", name: "Other Server" };

const mockServerActions = {
  op: null as { addr: string; serverName: string; phase: string; note: string | null } | null,
  dayzUp: false,
  launchResult: null,
  notice: null,
  setNotice: vi.fn(),
  verifyAndJoin: vi.fn(),
  subscribeOnly: vi.fn(),
  cancelWait: vi.fn(),
  phaseLabel: vi.fn(() => "DOWNLOADING…"),
  NOTICES: {},
};

// SSR takes zustand's initial-state snapshot, so route the hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/server-store")>();
  return { ...actual, useServerStore: liveHook(actual.useServerStore) };
});

vi.mock("./row-probe-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./row-probe-store")>();
  return { ...actual, useRowProbeStore: liveHook(actual.useRowProbeStore) };
});

vi.mock("@/hooks/use-server-actions", () => ({
  useServerActions: () => mockServerActions,
  phaseLabel: (op: { note: string | null }) => op.note ?? "DOWNLOADING…",
}));

vi.mock("./use-selection-readiness", () => ({
  useSelectionReadiness: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    toggleFavourite: vi.fn(() => Promise.resolve()),
    refreshVisibleServers: vi.fn(() => Promise.resolve()),
  };
});

// Captures the props of interactive elements as they are created, keyed by
// `data-el` (or `data-part` for nodes nested inside one), since
// renderToStaticMarkup discards event handlers from its HTML output.
let captured: Record<string, Record<string, unknown>> = {};

function resetCaptured() {
  captured = {};
}

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if ((type === "button" || type === "div") && props) {
        const key = (props["data-el"] as string | undefined) ?? (props["data-part"] as string | undefined);
        if (key) captured[key] = props;
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const mod = (overrides: Partial<ModReadinessEntry>): ModReadinessEntry => ({
  workshop_id: "1",
  name: "Some Mod",
  state: "ready",
  size_bytes: null,
  size_is_upper_bound: false,
  preview_url: null,
  is_unique: false,
  downloaded_bytes: null,
  total_bytes: null,
  ...overrides,
});

const readiness = (mods: ModReadinessEntry[], stale = false): ServerModReadiness => ({ stale, mods });

async function setReadiness(value: ServerModReadiness | null, loading: boolean) {
  const { useSelectionReadiness } = await import("./use-selection-readiness");
  vi.mocked(useSelectionReadiness).mockReturnValue({ readiness: value, loading });
}

async function render(value: Partial<ElementContextValue>, options?: Record<string, unknown>) {
  const { ServerJoin } = await import("./server-elements");
  resetCaptured();
  const html = renderToStaticMarkup(
    <ElementContextProvider value={value}>
      <ServerJoin options={options} />
    </ElementContextProvider>,
  );
  return html;
}

describe("ServerJoin", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    mockServerActions.dayzUp = false;
    mockServerActions.verifyAndJoin.mockClear();
  });

  it("calls verifyAndJoin with the element's own subject server on click, after stopping propagation", async () => {
    await setReadiness(null, false);
    await render({ subjectContext: { kind: "server", data: server } });

    expect(captured["server.join"]).toBeDefined();
    const onClick = captured["server.join"].onClick as (e: { stopPropagation: () => void }) => void;
    const stopPropagation = vi.fn();
    onClick({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalled();
    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server);
  });

  it("calls verifyAndJoin with the row's own subject even when a different server is selected", async () => {
    await setReadiness(null, false);
    await render({ subjectContext: { kind: "server", data: server }, selectedServer: otherServer });

    const onClick = captured["server.join"].onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });

    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server);
  });

  it("renders busy state with a spinner and the phase label when this server has the active op", async () => {
    await setReadiness(null, false);
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "downloading", note: "DOWNLOADING…" };
    const html = await render({ subjectContext: { kind: "server", data: server } });
    expect(html).toContain('data-state="busy"');
    expect(html).toContain("disabled");
    expect(html).toContain('data-part="spinner"');
    expect(html).toContain("DOWNLOADING…");
  });

  it("disables the row button (without the busy state) when a different server has the active op", async () => {
    await setReadiness(null, false);
    mockServerActions.op = { addr: otherServer.addr, serverName: otherServer.name, phase: "downloading", note: "DOWNLOADING…" };
    const html = await render({ subjectContext: { kind: "server", data: server } });
    expect(html).not.toContain('data-state="busy"');
    expect(html).toContain("disabled");
    expect(captured["server.join"].disabled).toBe(true);
    expect(html).toContain(">Join<");
  });

  it("renders the playing state, disabled with a Check icon, when DayZ is running and no op is active", async () => {
    await setReadiness(null, false);
    mockServerActions.dayzUp = true;
    const html = await render({ subjectContext: { kind: "server", data: server } });
    expect(html).toContain('data-state="playing"');
    expect(html).toContain("disabled");
    expect(html).toContain(">Playing<");
    expect(html).toContain("Quit the game before joining another server");
  });

  it("row context keeps the Join label regardless of selection readiness", async () => {
    await setReadiness(readiness([mod({ state: "not_subscribed" })]), false);
    const html = await render({ subjectContext: { kind: "server", data: server }, selectedServer: server });
    expect(html).toContain(">Join<");
    expect(html).not.toContain("needsMods");
  });

  it("selection idle label switches via joinAction based on the selected server's readiness", async () => {
    await setReadiness(readiness([mod({ state: "not_subscribed" })]), false);
    const html = await render({
      subjectContext: { kind: "server", data: server },
      contextName: "selection",
      selectedServer: server,
    });
    expect(html).toContain(">Subscribe &amp; join<");
    expect(html).toContain("needsMods");
  });

  it("selection idle label ignores readiness for a server that is not selected", async () => {
    await setReadiness(readiness([mod({ state: "not_subscribed" })]), false);
    const html = await render({
      subjectContext: { kind: "server", data: server },
      contextName: "selection",
      selectedServer: otherServer,
    });
    expect(html).toContain(">Join<");
  });

  it("shows the real formatted outstanding size for the selected server's fix-and-join sublabel", async () => {
    await setReadiness(readiness([mod({ state: "not_installed", size_bytes: 2_000_000 })]), false);
    const html = await render(
      { subjectContext: { kind: "server", data: server }, contextName: "selection", selectedServer: server },
      { wording: "fixAndJoin" },
    );
    expect(html).toContain('data-part="sublabel"');
    expect(html).toContain(formatBytes(2_000_000));
    expect(html).toContain("first");
  });

  it("prefixes the sublabel with 'up to' when the outstanding size is an estimate", async () => {
    await setReadiness(
      readiness([mod({ state: "needs_update", size_bytes: 5000, size_is_upper_bound: true })]),
      false,
    );
    const html = await render(
      { subjectContext: { kind: "server", data: server }, contextName: "selection", selectedServer: server },
      { wording: "fixAndJoin" },
    );
    expect(html).toContain(`up to ${formatBytes(5000)} first`);
  });

  it("omits the sublabel entirely when there is nothing outstanding", async () => {
    await setReadiness(readiness([mod({ state: "ready" })]), false);
    const html = await render(
      { subjectContext: { kind: "server", data: server }, contextName: "selection", selectedServer: server },
      { wording: "fixAndJoin" },
    );
    expect(html).not.toContain('data-part="sublabel"');
  });

  it("omits the sublabel when the element's subject is not the selected server", async () => {
    await setReadiness(readiness([mod({ state: "not_installed", size_bytes: 2_000_000 })]), false);
    const html = await render(
      { subjectContext: { kind: "server", data: server }, contextName: "selection", selectedServer: otherServer },
      { wording: "fixAndJoin" },
    );
    expect(html).not.toContain('data-part="sublabel"');
  });
});

function renderNode(
  node: ReactNode,
  value?: Partial<ElementContextValue>,
): string {
  return renderToStaticMarkup(<ElementContextProvider value={value}>{node}</ElementContextProvider>);
}

const offlineServer: Server = { ...server, online: false };

describe("ServerPlayers", () => {
  it("marks empty, full and queued states, with a queue part", async () => {
    const full: Server = { ...server, players: 60, max_players: 60, queue: 4 };
    const html = renderNode(
      <ServerPlayers options={{}} />,
      { subjectContext: { kind: "server", data: full } },
    );
    expect(html).toContain('data-state="full queued"');
    expect(html).toContain('data-part="queue"> +4</span>');
  });

  it("marks the empty state for zero players and offline on an offline server", async () => {
    const empty: Server = { ...offlineServer, players: 0 };
    const html = renderNode(<ServerPlayers options={{}} />, { subjectContext: { kind: "server", data: empty } });
    expect(html).toContain('data-state="empty offline"');
  });

  it("hides the queue part when showQueue is false", async () => {
    const queued: Server = { ...server, queue: 3 };
    const html = renderNode(<ServerPlayers options={{ showQueue: false }} />, {
      subjectContext: { kind: "server", data: queued },
    });
    expect(html).not.toContain('data-part="queue"');
  });

  it("format=count shows only the value part, no max", async () => {
    const html = renderNode(<ServerPlayers options={{ format: "count" }} />, {
      subjectContext: { kind: "server", data: server },
    });
    expect(html).toContain('data-part="value">5</span>');
    expect(html).not.toContain('data-part="max"');
  });
});

describe("ServerPing", () => {
  const withPing = (ping: number | null, online = true): Server => ({ ...server, ping, online });

  it.each([
    [80, "good"],
    [81, "fair"],
    [120, "fair"],
    [121, "poor"],
  ])("ping %d maps to state %s", async (ping, state) => {
    const html = renderNode(<ServerPing />, { subjectContext: { kind: "server", data: withPing(ping) } });
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain(`data-part="value">${ping}</span>`);
  });

  it("renders — and state unknown for a null ping", async () => {
    const html = renderNode(<ServerPing />, { subjectContext: { kind: "server", data: withPing(null) } });
    expect(html).toContain('data-state="unknown"');
    expect(html).toContain('data-part="value">—</span>');
  });

  it("renders — and unknown+offline for an offline server, ignoring a stale ping value", async () => {
    const html = renderNode(<ServerPing />, { subjectContext: { kind: "server", data: withPing(20, false) } });
    expect(html).toContain('data-state="unknown offline"');
    expect(html).toContain('data-part="value">—</span>');
  });

  it("selection form defaults showUnit to true", async () => {
    const html = renderNode(<ServerPing />, {
      subjectContext: { kind: "server", data: withPing(40) },
      contextName: "selection",
    });
    expect(html).toContain('data-part="unit"');
    expect(html).toContain(">40</span>");
    expect(html).toContain("ms</span>");
  });

  it("row form hides the unit by default", async () => {
    const html = renderNode(<ServerPing />, { subjectContext: { kind: "server", data: withPing(40) } });
    expect(html).not.toContain('data-part="unit"');
  });
});

describe("ServerModCount", () => {
  it("shows the known count, — for zero, state none", async () => {
    const zero: Server = { ...server, mod_count: 0 };
    const html = renderNode(<ServerModCount />, { subjectContext: { kind: "server", data: zero } });
    expect(html).toContain('data-state="none"');
    expect(html).toContain('data-part="value">—</span>');
  });

  it("shows ? and state unprobed for a modded server with an unknown count", async () => {
    const unprobed: Server = { ...server, mod_count: null, modded: true };
    const html = renderNode(<ServerModCount />, { subjectContext: { kind: "server", data: unprobed } });
    expect(html).toContain('data-state="unprobed"');
    expect(html).toContain('data-part="value">?</span>');
    expect(html).toContain("This server declares mods");
  });

  it("shows — and state none for a vanilla server with an unknown count", async () => {
    const vanilla: Server = { ...server, mod_count: null, modded: false };
    const html = renderNode(<ServerModCount />, { subjectContext: { kind: "server", data: vanilla } });
    expect(html).toContain('data-state="none"');
    expect(html).toContain('data-part="value">—</span>');
  });

  it("selection form shows 0 for a vanilla server instead of —", async () => {
    const vanilla: Server = { ...server, mod_count: null, modded: false };
    const html = renderNode(<ServerModCount />, {
      subjectContext: { kind: "server", data: vanilla },
      contextName: "selection",
    });
    expect(html).toContain('data-part="value"');
    expect(html).toContain(">0<");
  });
});

describe("ServerGameTime", () => {
  it("day state includes icon, time and multiplier, text content matches formatGameTime", async () => {
    const day: Server = { ...server, in_game_time: "14:00", day_multiplier: 1, night_multiplier: 1 };
    const html = renderNode(<ServerGameTime />, { subjectContext: { kind: "server", data: day } });
    expect(html).toContain('data-state="day"');
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text).toBe(formatGameTime(day.in_game_time, day.day_multiplier, day.night_multiplier));
    expect(gameTimeParts(day.in_game_time, day.day_multiplier, day.night_multiplier).state).toBe("day");
  });

  it("night state renders the night glyph", async () => {
    const night: Server = { ...server, in_game_time: "23:00", day_multiplier: 1, night_multiplier: 2 };
    const html = renderNode(<ServerGameTime />, { subjectContext: { kind: "server", data: night } });
    expect(html).toContain('data-state="night"');
    expect(html).toContain("☾");
  });

  it("unknown state renders --:-- with no icon or multiplier part", async () => {
    const unknown: Server = { ...server, in_game_time: null };
    const html = renderNode(<ServerGameTime />, { subjectContext: { kind: "server", data: unknown } });
    expect(html).toContain('data-state="unknown"');
    expect(html).toContain('data-part="time">--:--</span>');
    expect(html).not.toContain('data-part="icon"');
    expect(html).not.toContain('data-part="multiplier"');
  });

  it("hides icon and multiplier when their options are false", async () => {
    const day: Server = { ...server, in_game_time: "14:00", day_multiplier: 1, night_multiplier: 1 };
    const html = renderNode(<ServerGameTime options={{ showIcon: false, showMultiplier: false }} />, {
      subjectContext: { kind: "server", data: day },
    });
    expect(html).not.toContain('data-part="icon"');
    expect(html).not.toContain('data-part="multiplier"');
    expect(html).toContain('data-part="time">2:00 PM</span>');
  });
});

describe("ServerTags", () => {
  beforeEach(() => {
    useServerStore.setState({ modPending: {} });
  });

  it("renders chips in order offline, official, 1PP, modded, locked, BattlEye, mod update, with registry state names", async () => {
    useServerStore.setState({ modPending: { [server.addr]: true } });
    const all: Server = { ...offlineServer, official: true, first_person: true, modded: true, locked: true, battleye: true };
    const html = renderNode(<ServerTags options={{ showBattleye: true }} />, {
      subjectContext: { kind: "server", data: all },
    });
    const order = ["offline", "official", "firstPerson", "modded", "locked", "battleye", "modUpdate"];
    let lastIndex = -1;
    for (const state of order) {
      const idx = html.indexOf(`data-state="${state}"`);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
    expect(html).toContain(">OFFLINE<");
    expect(html).toContain(">1PP<");
    expect(html).toContain(">MODDED<");
    expect(html).toContain(">LOCKED<");
    expect(html).toContain(">BATTLEYE<");
    expect(html).toContain(">UPDATE<");
  });

  it("defaults officialWording to vanilla, showing VANILLA text", async () => {
    const official: Server = { ...server, official: true };
    const html = renderNode(<ServerTags />, { subjectContext: { kind: "server", data: official } });
    expect(html).toContain(">VANILLA<");
  });

  it("shows OFFICIAL when officialWording is official", async () => {
    const official: Server = { ...server, official: true };
    const html = renderNode(<ServerTags options={{ officialWording: "official" }} />, {
      subjectContext: { kind: "server", data: official },
    });
    expect(html).toContain(">OFFICIAL<");
  });

  it("hides the BattlEye chip by default even when the server has it", async () => {
    const be: Server = { ...server, battleye: true };
    const html = renderNode(<ServerTags />, { subjectContext: { kind: "server", data: be } });
    expect(html).not.toContain("BATTLEYE");
  });

  it("shows the mod update chip only while modPending is set for this server", async () => {
    useServerStore.setState({ modPending: { [server.addr]: true } });
    const html = renderNode(<ServerTags />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain(">UPDATE<");
    expect(html).toContain("A declared mod has a Steam update pending");
  });
});

describe("ServerLastPlayed", () => {
  it("renders nothing for a never-played server by default", async () => {
    const never: Server = { ...server, last_played: null };
    const html = renderNode(<ServerLastPlayed />, { subjectContext: { kind: "server", data: never } });
    expect(html).toBe("");
  });

  it("renders — with showNever for a never-played server", async () => {
    const never: Server = { ...server, last_played: null };
    const html = renderNode(<ServerLastPlayed options={{ showNever: true }} />, {
      subjectContext: { kind: "server", data: never },
    });
    expect(html).toContain('data-part="value">—</span>');
  });

  it("defaults the label to 'played' and drops it with label: ''", async () => {
    const played: Server = { ...server, last_played: Math.floor(Date.now() / 1000) - 120 };
    const withLabel = renderNode(<ServerLastPlayed />, { subjectContext: { kind: "server", data: played } });
    expect(withLabel).toContain('data-part="label">played</span>');

    const withoutLabel = renderNode(<ServerLastPlayed options={{ label: "" }} />, {
      subjectContext: { kind: "server", data: played },
    });
    expect(withoutLabel).not.toContain('data-part="label"');
  });
});

describe("ServerVersion", () => {
  it("renders the version text", async () => {
    const html = renderNode(<ServerVersion />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain('data-part="text">1.25</span>');
  });

  it("falls back to 'unknown' with state unknown when version is empty", async () => {
    const noVersion: Server = { ...server, version: "" };
    const html = renderNode(<ServerVersion />, { subjectContext: { kind: "server", data: noVersion } });
    expect(html).toContain('data-state="unknown"');
    expect(html).toContain('data-part="text">unknown</span>');
  });
});

describe("ServerAddress selection form", () => {
  it("renders address and gamePort parts without a DayZ version suffix", async () => {
    const html = renderNode(<ServerAddress options={{ showGamePort: true }} />, {
      subjectContext: { kind: "server", data: server },
      contextName: "selection",
    });
    expect(html).toContain(`data-part="address">${server.addr}</span>`);
    expect(html).toContain(`data-part="gamePort">game port ${server.game_port}</span>`);
    expect(html).not.toContain("DayZ");
  });

  it("omits the gamePort part when showGamePort is false", async () => {
    const html = renderNode(<ServerAddress />, {
      subjectContext: { kind: "server", data: server },
      contextName: "selection",
    });
    expect(html).not.toContain('data-part="gamePort"');
  });
});

describe("offline state on server elements", () => {
  it("adds offline to server.name, server.region and server.modCount for an offline server", async () => {
    const html = renderNode(
      <div>
        <ServerName />
        <ServerRegion />
        <ServerModCount />
      </div>,
      { subjectContext: { kind: "server", data: offlineServer } },
    );
    const matches = html.match(/offline/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

function renderInteractive(node: ReactNode, value?: Partial<ElementContextValue>): string {
  resetCaptured();
  return renderToStaticMarkup(<ElementContextProvider value={value}>{node}</ElementContextProvider>);
}

describe("ServerFavourite", () => {
  it("optimistically toggles the store and persists via toggleFavourite", async () => {
    const { toggleFavourite } = await import("@/lib/tauri");
    useServerStore.setState({ servers: [server], selectedServer: null });

    renderInteractive(<ServerFavourite />, { subjectContext: { kind: "server", data: server } });
    const onClick = captured["server.favourite"].onClick as (e: { stopPropagation: () => void }) => Promise<void>;
    await onClick({ stopPropagation: vi.fn() });

    expect(useServerStore.getState().servers[0].favourite).toBe(true);
    expect(toggleFavourite).toHaveBeenCalledWith(server.addr, server.query_port, true);
  });

  it("reverts the optimistic toggle when the persist call rejects", async () => {
    const { toggleFavourite } = await import("@/lib/tauri");
    vi.mocked(toggleFavourite).mockRejectedValueOnce(new Error("network"));
    useServerStore.setState({ servers: [server], selectedServer: null });

    renderInteractive(<ServerFavourite />, { subjectContext: { kind: "server", data: server } });
    const onClick = captured["server.favourite"].onClick as (e: { stopPropagation: () => void }) => Promise<void>;
    await onClick({ stopPropagation: vi.fn() });

    expect(useServerStore.getState().servers[0].favourite).toBe(false);
  });

  it("defaults to icon-only display, adding the label part only for iconLabel", async () => {
    const iconOnly = renderInteractive(<ServerFavourite />, { subjectContext: { kind: "server", data: server } });
    expect(iconOnly).not.toContain('data-part="label"');

    const withLabel = renderInteractive(<ServerFavourite options={{ display: "iconLabel" }} />, {
      subjectContext: { kind: "server", data: server },
    });
    expect(withLabel).toContain('data-part="label"');
  });

  it("renders state on when favourited", async () => {
    const fav: Server = { ...server, favourite: true };
    const html = renderInteractive(<ServerFavourite />, { subjectContext: { kind: "server", data: fav } });
    expect(html).toContain('data-state="on"');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe("ServerMenu", () => {
  it("serverActions (default) renders a plain trigger button with no popup machinery", async () => {
    const html = renderInteractive(<ServerMenu />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain('data-el="server.menu"');
    expect(html).not.toContain('data-part="popup"');
  });

  it("serverLoad renders the popup item only once opened", () => {
    const closedHtml = renderToStaticMarkup(<>{ServerLoadMenuPopup({ open: false, onLoad: vi.fn() })}</>);
    expect(closedHtml).toBe("");

    const openedHtml = renderToStaticMarkup(<>{ServerLoadMenuPopup({ open: true, onLoad: vi.fn() })}</>);
    expect(openedHtml).toContain('data-part="popup"');
    expect(openedHtml).toContain('role="menu"');
    expect(openedHtml).toContain("Load to menu");
  });

  it("serverLoad trigger is disabled while an op runs or DayZ is running", () => {
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "downloading", note: null };
    const html = renderInteractive(<ServerMenu options={{ menu: "serverLoad" }} />, {
      subjectContext: { kind: "server", data: server },
    });
    mockServerActions.op = null;
    expect(captured["trigger"].disabled).toBe(true);
    expect(html).toContain('data-state="disabled"');
  });
});

describe("ServerLoadToMenu", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    mockServerActions.dayzUp = false;
    mockServerActions.verifyAndJoin.mockClear();
  });

  it("calls verifyAndJoin with toMenu=true and stops propagation", () => {
    renderInteractive(<ServerLoadToMenu />, { subjectContext: { kind: "server", data: server } });
    const onClick = captured["server.loadToMenu"].onClick as (e: { stopPropagation: () => void }) => void;
    const stopPropagation = vi.fn();
    onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server, true);
  });

  it("is disabled while any op runs or DayZ is running", () => {
    mockServerActions.dayzUp = true;
    const html = renderInteractive(<ServerLoadToMenu />, { subjectContext: { kind: "server", data: server } });
    expect(captured["server.loadToMenu"].disabled).toBe(true);
    expect(html).toContain("disabled");
  });
});

describe("ServerCancel", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    mockServerActions.cancelWait.mockClear();
  });

  it("renders nothing when there is no active op for this server", () => {
    const html = renderInteractive(<ServerCancel />, { subjectContext: { kind: "server", data: server } });
    expect(html).toBe("");
  });

  it("renders nothing while launching or starting", () => {
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "launching", note: null };
    const html = renderInteractive(<ServerCancel />, { subjectContext: { kind: "server", data: server } });
    expect(html).toBe("");
  });

  it("renders and calls cancelWait for a cancellable op of this server", () => {
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "downloading", note: null };
    const html = renderInteractive(<ServerCancel />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain(">Cancel<");
    const onClick = captured["server.cancel"].onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });
    expect(mockServerActions.cancelWait).toHaveBeenCalled();
  });
});

describe("ServerManageMods", () => {
  it("shows the selection readiness mod count once loaded", async () => {
    await setReadiness(readiness([mod({}), mod({ workshop_id: "2" })]), false);
    const html = renderInteractive(<ServerManageMods />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain("· 2 declared");
  });

  it("falls back to server.mod_count while readiness has not loaded", async () => {
    await setReadiness(null, true);
    const html = renderInteractive(<ServerManageMods />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain(`· ${server.mod_count} declared`);
  });

  it("omits the count entirely when unknown", async () => {
    const unknown: Server = { ...server, mod_count: null };
    await setReadiness(null, true);
    const html = renderInteractive(<ServerManageMods />, { subjectContext: { kind: "server", data: unknown } });
    expect(html).not.toContain("declared");
  });

  it("switches to the mods view on click", async () => {
    await setReadiness(null, false);
    const onViewChange = vi.fn();
    renderInteractive(<ServerManageMods />, { subjectContext: { kind: "server", data: server }, onViewChange });
    const onClick = captured["server.manageMods"].onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });
    expect(onViewChange).toHaveBeenCalledWith("mods");
  });
});

describe("ServerDeselect", () => {
  it("clears the selection when clicked", () => {
    useServerStore.setState({ selectedServer: server });
    renderInteractive(<ServerDeselect />, { subjectContext: { kind: "server", data: server } });
    const onClick = captured["server.deselect"].onClick as () => void;
    onClick();
    expect(useServerStore.getState().selectedServer).toBeNull();
  });

  it("reads Close details by default", () => {
    const html = renderInteractive(<ServerDeselect />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain('aria-label="Close details"');
    expect(html).toContain('data-part="icon"');
  });
});

describe("ServerRefresh", () => {
  beforeEach(() => {
    useRowProbeStore.setState({ probingKey: null });
  });

  it("probes only this server and marks it busy while in flight", async () => {
    const { refreshVisibleServers } = await import("@/lib/tauri");
    vi.mocked(refreshVisibleServers).mockClear();
    let resolveProbe: () => void = () => {};
    vi.mocked(refreshVisibleServers).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = () => resolve(undefined);
      }),
    );

    const html = renderInteractive(<ServerRefresh />, { subjectContext: { kind: "server", data: server } });
    const onClick = captured["server.refresh"].onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });

    expect(refreshVisibleServers).toHaveBeenCalledWith([{ addr: server.addr, query_port: server.query_port }], "row");
    expect(useRowProbeStore.getState().probingKey).toBe(`${server.addr}:${server.query_port}`);
    expect(html).not.toContain('data-state="busy"');

    resolveProbe();
    await Promise.resolve();
    await Promise.resolve();
    expect(useRowProbeStore.getState().probingKey).toBeNull();
  });

  it("disables other rows while one server is probing", () => {
    useRowProbeStore.setState({ probingKey: `${server.addr}:${server.query_port}` });
    const html = renderInteractive(<ServerRefresh />, { subjectContext: { kind: "server", data: otherServer } });
    expect(html).toContain('data-state="disabled"');
    expect(captured["server.refresh"].disabled).toBe(true);
  });

  it("shows busy state and a spinning icon for the probing row itself", () => {
    useRowProbeStore.setState({ probingKey: `${server.addr}:${server.query_port}` });
    const html = renderInteractive(<ServerRefresh />, { subjectContext: { kind: "server", data: server } });
    expect(html).toContain('data-state="busy"');
    expect(html).toContain("animate-spin");
  });
});
