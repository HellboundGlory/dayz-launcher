import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Server } from "@/types/server";
import type { ModReadinessEntry, ServerModReadiness } from "@/types/server";
import { formatBytes, formatGameTime } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";
import { useLaunchStore } from "@/stores/launch-store";
import { useRowProbeStore } from "./row-probe-store";
import { useThemeStore } from "../theme-store";
import type { ThemeFile } from "@/types/theme";
import { ElementContextProvider, type ElementContextValue } from "./context";
import { PopupContextProvider } from "./popup-elements";
import {
  ServerAddress,
  ServerCancel,
  ServerCheckMods,
  ServerCopyAddress,
  ServerDeselect,
  ServerFavourite,
  ServerGameTime,
  ServerInfo,
  ServerJoin,
  ServerLastPlayed,
  ServerLoadMenuPopup,
  ServerLoadToMenu,
  ServerManageMods,
  ServerMenu,
  ServerModCount,
  ServerModUpdate,
  ServerName,
  ServerPing,
  ServerPlayers,
  ServerRefresh,
  ServerRegion,
  ServerSubscribeAll,
  ServerTags,
  ServerUnsubscribeUnique,
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
const offlineServer: Server = { ...server, online: false };

const mockServerActions = {
  op: null as { addr: string; serverName: string; phase: string; note: string | null } | null,
  dayzUp: false,
  launchResult: null,
  notice: null,
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

vi.mock("./use-server-readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-server-readiness")>()),
  useServerReadiness: vi.fn(),
}));

const askConfirmCalls: { title: string; message: string; action: () => void }[] = [];
vi.mock("@/components/confirm-dialog", () => ({
  useConfirm: () => (title: string, message: string, action: () => void) => {
    askConfirmCalls.push({ title, message, action });
  },
}));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return {
    ...actual,
    toggleFavourite: vi.fn(() => Promise.resolve()),
    refreshVisibleServers: vi.fn(() => Promise.resolve()),
    checkServerMods: vi.fn(),
    getUniqueModsSummary: vi.fn(),
    unsubscribeUniqueMods: vi.fn(),
    copyServerAddress: vi.fn(),
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
  const { useServerReadiness } = await import("./use-server-readiness");
  vi.mocked(useServerReadiness).mockReturnValue({ readiness: value, loading });
}

function render(node: ReactNode, value?: Partial<ElementContextValue>): string {
  resetCaptured();
  return renderToStaticMarkup(<ElementContextProvider value={value}>{node}</ElementContextProvider>);
}

function serverContext(data: Server): Partial<ElementContextValue> {
  return { subjectContext: { kind: "server", data } };
}

function click(el: string) {
  const stopPropagation = vi.fn();
  const result = (captured[el].onClick as (e: { stopPropagation: () => void }) => unknown)({ stopPropagation });
  return { stopPropagation, result };
}

describe("ServerJoin", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    mockServerActions.dayzUp = false;
  });

  it("joins the row's own server, after stopping propagation, even when another server is selected", async () => {
    await setReadiness(null, false);

    render(<ServerJoin />, serverContext(server));
    expect(click("server.join").stopPropagation).toHaveBeenCalled();
    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server);

    mockServerActions.verifyAndJoin.mockClear();
    render(<ServerJoin />, { ...serverContext(server), selectedServer: otherServer });
    expect(click("server.join").stopPropagation).toHaveBeenCalled();
    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server);
  });

  it("renders the busy state with a spinner and the phase label when this server has the active op", async () => {
    await setReadiness(null, false);
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "downloading", note: "DOWNLOADING…" };
    const html = render(<ServerJoin />, serverContext(server));
    expect(html).toContain('data-state="busy"');
    expect(captured["server.join"].disabled).toBe(true);
    expect(html).toContain('data-part="spinner"');
    expect(html).toContain("DOWNLOADING…");
  });

  it("disables the button, without the busy state, when a different server has the active op", async () => {
    await setReadiness(null, false);
    mockServerActions.op = { addr: otherServer.addr, serverName: otherServer.name, phase: "downloading", note: "DOWNLOADING…" };
    const html = render(<ServerJoin />, serverContext(server));
    expect(html).not.toContain('data-state="busy"');
    expect(captured["server.join"].disabled).toBe(true);
    expect(html).toContain(">Join<");
  });

  it("renders the playing state, disabled with a Check icon, when DayZ is running and no op is active", async () => {
    await setReadiness(null, false);
    mockServerActions.dayzUp = true;
    const html = render(<ServerJoin />, serverContext(server));
    expect(html).toContain('data-state="playing"');
    expect(captured["server.join"].disabled).toBe(true);
    expect(html).toContain(">Playing<");
    expect(html).toContain("Quit the game before joining another server");
  });

  it.each([
    { contextName: "row", wording: "fixAndJoin", modded: true, pending: true, label: "Fix and join", icon: "lucide-download", needsMods: true },
    { contextName: "modal", wording: "fixAndJoin", modded: true, pending: true, label: "Fix and join", icon: "lucide-download", needsMods: true },
    { contextName: "row", wording: "fixAndJoin", modded: true, pending: false, label: "Join", icon: "lucide-download", needsMods: false },
    { contextName: "modal", wording: "fixAndJoin", modded: true, pending: false, label: "Join", icon: "lucide-download", needsMods: false },
    { contextName: "row", wording: "join", modded: true, pending: true, label: "Join", icon: "lucide-download", needsMods: true },
    { contextName: "row", wording: "join", modded: false, pending: false, label: "Join", icon: "lucide-play", needsMods: false },
  ] as const)("$contextName idle join: $wording, modded $modded, pending $pending", async (c) => {
    await setReadiness(null, false);
    useServerStore.setState({ modPending: c.pending ? { [server.addr]: true } : {} });
    const html = render(<ServerJoin options={{ wording: c.wording }} />, {
      ...serverContext({ ...server, modded: c.modded }),
      contextName: c.contextName,
    });
    expect(html).toContain(`>${c.label}</span>`);
    expect(html).toContain(c.icon);
    expect(html.includes("needsMods")).toBe(c.needsMods);
  });

  const fetchedReadinessCases: {
    where: string;
    contextName: ElementContextValue["contextName"];
    popupId: string;
    mods: ModReadinessEntry[];
    label: string;
  }[] = [
    { where: "a selection", contextName: "selection", popupId: "", mods: [mod({ state: "ready" })], label: "Join" },
    { where: "a selection", contextName: "selection", popupId: "", mods: [mod({ state: "needs_update" })], label: "Fix and join" },
    { where: "a modal", contextName: "modal", popupId: "", mods: [mod({ state: "needs_update" })], label: "Fix and join" },
    { where: "a popup opened from a row", contextName: "row", popupId: "serverActions", mods: [mod({ state: "needs_update" })], label: "Fix and join" },
  ];

  it.each(fetchedReadinessCases)("fix-and-join reads fetched readiness in $where", async (c) => {
    await setReadiness(readiness(c.mods), false);
    useServerStore.setState({ modPending: {} });
    const html = render(
      <PopupContextProvider popupId={c.popupId} close={() => {}}>
        <ServerJoin options={{ wording: "fixAndJoin" }} />
      </PopupContextProvider>,
      { ...serverContext(server), contextName: c.contextName, selectedServer: server },
    );
    expect(html).toContain(`>${c.label}</span>`);
    expect(html.includes("needsMods")).toBe(c.label === "Fix and join");
  });
});

describe("ServerPlayers", () => {
  it("marks full, queued, empty and offline states, with a queue part", () => {
    const full = render(<ServerPlayers options={{}} />, {
      ...serverContext({ ...server, players: 60, max_players: 60, queue: 4 }),
    });
    expect(full).toContain('data-state="full queued"');
    expect(full).toContain('data-part="queue" title="4 waiting in the join queue">+4</span>');

    const empty = render(<ServerPlayers options={{}} />, {
      ...serverContext({ ...offlineServer, players: 0 }),
    });
    expect(empty).toContain('data-state="empty offline"');
  });

  it("hides the queue part when showQueue is false", () => {
    const html = render(<ServerPlayers options={{ showQueue: false }} />, {
      ...serverContext({ ...server, queue: 3 }),
    });
    expect(html).not.toContain('data-part="queue"');
  });

  it("format=count shows only the value part, no max", () => {
    const html = render(<ServerPlayers options={{ format: "count" }} />, serverContext(server));
    expect(html).toContain('data-part="value">5</span>');
    expect(html).not.toContain('data-part="max"');
  });
});

describe("ServerPing", () => {
  it.each([
    { el: "server.players", node: (options: Record<string, unknown>) => <ServerPlayers options={options} />, caption: " players" },
    { el: "server.ping", node: (options: Record<string, unknown>) => <ServerPing options={options} />, caption: " ping" },
  ])("$el shows its caption unless showCaption is false", ({ node, caption }) => {
    const value = serverContext(server);
    expect(render(node({}), value)).toContain(`data-part="caption">${caption}</span>`);
    expect(render(node({ showCaption: false }), value)).not.toContain('data-part="caption"');
  });

  it.each([
    [80, "good"],
    [81, "fair"],
    [120, "fair"],
    [121, "poor"],
  ])("ping %d maps to state %s", (ping, state) => {
    const html = render(<ServerPing />, serverContext({ ...server, ping }));
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain(`data-part="value">${ping}</span>`);
  });

  it("renders — with the unknown state for a null ping, and unknown+offline for a stale one", () => {
    const nullPing = render(<ServerPing />, serverContext({ ...server, ping: null }));
    expect(nullPing).toContain('data-state="unknown"');
    expect(nullPing).toContain('data-part="value">—</span>');

    const stale = render(<ServerPing />, serverContext({ ...server, ping: 20, online: false }));
    expect(stale).toContain('data-state="unknown offline"');
    expect(stale).toContain('data-part="value">—</span>');
  });

  it("hides the unit by default", () => {
    expect(render(<ServerPing />, serverContext({ ...server, ping: 40 }))).not.toContain('data-part="unit"');
  });
});

describe("ServerModCount", () => {
  it.each([
    { name: "a known count of zero", patch: { mod_count: 0 }, state: "none", text: "—", title: undefined },
    { name: "an unprobed modded server", patch: { mod_count: null, modded: true }, state: "unprobed", text: "?", title: "This server declares mods" },
    { name: "an unprobed vanilla server", patch: { mod_count: null, modded: false }, state: "none vanilla", text: "—", title: undefined },
  ])("reads $text with state $state for $name", ({ patch, state, text, title }) => {
    const html = render(<ServerModCount />, serverContext({ ...server, ...patch }));
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain(`data-part="value">${text}</span>`);
    if (title) expect(html).toContain(title);
  });
});

describe("ServerGameTime", () => {
  it("day state renders the glyph, time and multiplier, joining to the formatGameTime text", () => {
    const day: Server = { ...server, in_game_time: "14:00", day_multiplier: 1, night_multiplier: 1 };
    const html = render(<ServerGameTime />, serverContext(day));
    expect(html).toContain('data-state="day"');
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text).toBe(formatGameTime(day.in_game_time, day.day_multiplier, day.night_multiplier));
  });

  it("night state renders the night glyph", () => {
    const night: Server = { ...server, in_game_time: "23:00", day_multiplier: 1, night_multiplier: 2 };
    const html = render(<ServerGameTime />, serverContext(night));
    expect(html).toContain('data-state="night"');
    expect(html).toContain("☾");
  });

  it("unknown state renders --:-- with no icon or multiplier part", () => {
    const html = render(<ServerGameTime />, serverContext({ ...server, in_game_time: null }));
    expect(html).toContain('data-state="unknown"');
    expect(html).toContain('data-part="time">--:--</span>');
    expect(html).not.toContain('data-part="icon"');
    expect(html).not.toContain('data-part="multiplier"');
  });

  it("hides icon and multiplier when their options are false", () => {
    const day: Server = { ...server, in_game_time: "14:00", day_multiplier: 1, night_multiplier: 1 };
    const html = render(<ServerGameTime options={{ showIcon: false, showMultiplier: false }} />, serverContext(day));
    expect(html).not.toContain('data-part="icon"');
    expect(html).not.toContain('data-part="multiplier"');
    expect(html).toContain('data-part="time">2:00 PM</span>');
  });
});

describe("ServerTags", () => {
  beforeEach(() => {
    useServerStore.setState({ modPending: {} });
  });

  it("renders chips in order offline, official, modded, 1PP, BattlEye, locked, mod update, with registry state names", () => {
    useServerStore.setState({ modPending: { [server.addr]: true } });
    const all: Server = { ...offlineServer, official: true, first_person: true, modded: true, locked: true, battleye: true };
    const html = render(<ServerTags options={{ showBattleye: true }} />, serverContext(all));
    const order = ["offline", "official", "modded", "firstPerson", "battleye", "locked", "modUpdate"];
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

  it("reads its officialWording option, defaulting to VANILLA", () => {
    const value = serverContext({ ...server, official: true });
    expect(render(<ServerTags />, value)).toContain(">VANILLA<");
    expect(render(<ServerTags options={{ officialWording: "official" }} />, value)).toContain(">OFFICIAL<");
  });

  it("hides the BattlEye chip by default even when the server has it", () => {
    expect(render(<ServerTags />, serverContext({ ...server, battleye: true }))).not.toContain("BATTLEYE");
  });

  it("shows the mod update chip only while modPending is set for this server", () => {
    useServerStore.setState({ modPending: { [server.addr]: true } });
    const html = render(<ServerTags />, serverContext(server));
    expect(html).toContain(">UPDATE<");
    expect(html).toContain("A declared mod has a Steam update pending");
  });
});

describe("ServerLastPlayed", () => {
  it("renders nothing for a never-played server by default, and — with showNever", () => {
    const value = serverContext({ ...server, last_played: null });
    expect(render(<ServerLastPlayed />, value)).toBe("");
    expect(render(<ServerLastPlayed options={{ showNever: true }} />, value)).toContain('data-part="value">—</span>');
  });

  it("defaults the label to 'played' and drops it with label: ''", () => {
    const played: Server = { ...server, last_played: Math.floor(Date.now() / 1000) - 120 };
    expect(render(<ServerLastPlayed />, serverContext(played))).toContain('data-part="label">played</span>');
    expect(render(<ServerLastPlayed options={{ label: "" }} />, serverContext(played))).not.toContain('data-part="label"');
  });

  it("with recentOnly renders only inside the Recent view", () => {
    const played: Server = { ...server, last_played: Math.floor(Date.now() / 1000) - 120 };
    const subjectContext = { kind: "server" as const, data: played };
    expect(render(<ServerLastPlayed options={{ recentOnly: true }} />, { subjectContext, activeView: "servers" })).toBe("");
    expect(
      render(<ServerLastPlayed options={{ recentOnly: true }} />, { subjectContext, activeView: "recent" }),
    ).toContain('data-part="value"');
  });

  it("format date renders the locale date", () => {
    const ts = 1_700_000_000;
    const html = render(<ServerLastPlayed options={{ format: "date" }} />, serverContext({ ...server, last_played: ts }));
    expect(html).toContain(`data-part="value">${new Date(ts * 1000).toLocaleDateString()}</span>`);
  });
});

describe("ServerVersion", () => {
  it("renders the version text, falling back to unknown when it is empty", () => {
    expect(render(<ServerVersion />, serverContext(server))).toContain('data-part="text">1.25</span>');

    const empty = render(<ServerVersion />, serverContext({ ...server, version: "" }));
    expect(empty).toContain('data-state="unknown"');
    expect(empty).toContain('data-part="text">unknown</span>');
  });
});

describe("server.region", () => {
  it.each([
    ["name", "NA", "North America"],
    ["code", "NA", "North America"],
    ["code", null, null],
  ])("hover title for format %s, country %s", (format, code, title) => {
    const html = render(<ServerRegion options={{ format }} />, serverContext({ ...server, country_code: code }));
    if (title) expect(html).toContain(`title="${title}"`);
    else expect(html).not.toContain("title=");
  });
});

describe("offline state on server elements", () => {
  it("adds offline to server.name, server.region and server.modCount for an offline server", () => {
    const value = serverContext(offlineServer);
    expect(render(<ServerName />, value)).toContain('data-state="offline"');
    expect(render(<ServerRegion />, value)).toContain('data-state="offline"');
    expect(render(<ServerModCount />, value)).toContain('data-state="offline"');
  });
});

describe("ServerFavourite", () => {
  it("optimistically toggles the store and persists via toggleFavourite", async () => {
    const { toggleFavourite } = await import("@/lib/tauri");
    useServerStore.setState({ servers: [server], selectedServer: null });

    render(<ServerFavourite />, serverContext(server));
    await click("server.favourite").result;

    expect(useServerStore.getState().servers[0].favourite).toBe(true);
    expect(toggleFavourite).toHaveBeenCalledWith(server.addr, server.query_port, true);
  });

  it("reverts the optimistic toggle when the persist call rejects", async () => {
    const { toggleFavourite } = await import("@/lib/tauri");
    vi.mocked(toggleFavourite).mockRejectedValueOnce(new Error("network"));
    useServerStore.setState({ servers: [server], selectedServer: null });

    render(<ServerFavourite />, serverContext(server));
    await click("server.favourite").result;

    expect(useServerStore.getState().servers[0].favourite).toBe(false);
  });

  it("defaults to icon-only display, adding the label part only for iconLabel", () => {
    expect(render(<ServerFavourite />, serverContext(server))).not.toContain('data-part="label"');
    expect(render(<ServerFavourite options={{ display: "iconLabel" }} />, serverContext(server))).toContain('data-part="label"');
  });

  it("renders state on when favourited", () => {
    const html = render(<ServerFavourite />, serverContext({ ...server, favourite: true }));
    expect(html).toContain('data-state="on"');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe("ServerMenu", () => {
  it("renders the menu trigger named for the server, with and without a theme popup file", () => {
    const value = serverContext(server);
    const plain = render(<ServerMenu />, value);
    expect(plain).toContain('data-part="trigger"');
    expect(plain).toContain('aria-haspopup="menu"');
    expect(plain).toContain('aria-label="More actions for DayZ Test Server"');

    useThemeStore.setState({
      activeId: "local.test",
      themeFiles: { "local.test": { layouts: { "layout/popups/serverActions.json": {} } } as unknown as ThemeFile },
    });
    try {
      const themed = render(<ServerMenu />, value);
      expect(themed).toContain('data-part="trigger"');
      expect(themed).toContain('aria-haspopup="menu"');
    } finally {
      useThemeStore.setState({ activeId: "neutral", themeFiles: {} });
    }
  });

  it("renders the serverLoad popup item only once opened", () => {
    const closedHtml = renderToStaticMarkup(<>{ServerLoadMenuPopup({ open: false, onLoad: vi.fn() })}</>);
    expect(closedHtml).toBe("");

    const openedHtml = renderToStaticMarkup(<>{ServerLoadMenuPopup({ open: true, onLoad: vi.fn() })}</>);
    expect(openedHtml).toContain('data-part="popup"');
    expect(openedHtml).toContain('role="menu"');
    expect(openedHtml).toContain("Load to menu");
  });

  it("disables the serverLoad trigger while an op runs or DayZ is running", () => {
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "downloading", note: null };
    const html = render(<ServerMenu options={{ menu: "serverLoad" }} />, serverContext(server));
    mockServerActions.op = null;
    expect(captured["trigger"].disabled).toBe(true);
    expect(html).toContain('data-state="disabled"');
  });
});

describe("ServerLoadToMenu", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    mockServerActions.dayzUp = false;
  });

  it("calls verifyAndJoin with toMenu=true and stops propagation", () => {
    render(<ServerLoadToMenu />, serverContext(server));
    expect(click("server.loadToMenu").stopPropagation).toHaveBeenCalled();
    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server, true);
  });

  it("is disabled while any op runs or DayZ is running", () => {
    mockServerActions.dayzUp = true;
    const html = render(<ServerLoadToMenu />, serverContext(server));
    expect(captured["server.loadToMenu"].disabled).toBe(true);
    expect(html).toContain("disabled");
  });
});

describe("ServerCancel", () => {
  beforeEach(() => {
    mockServerActions.op = null;
  });

  it("renders nothing without a cancellable op of this server", () => {
    const value = serverContext(server);
    expect(render(<ServerCancel />, value)).toBe("");
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "launching", note: null };
    expect(render(<ServerCancel />, value)).toBe("");
  });

  it("renders and calls cancelWait for a cancellable op of this server", () => {
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "downloading", note: null };
    expect(render(<ServerCancel />, serverContext(server))).toContain(">Cancel<");
    click("server.cancel");
    expect(mockServerActions.cancelWait).toHaveBeenCalled();
  });
});

describe("ServerManageMods", () => {
  it("reads the fetched mod count, the declared count while loading, or nothing", async () => {
    const value = serverContext(server);
    await setReadiness(readiness([mod({}), mod({ workshop_id: "2" })]), false);
    expect(render(<ServerManageMods />, value)).toContain("· 2 declared");

    await setReadiness(null, true);
    expect(render(<ServerManageMods />, value)).toContain(`· ${server.mod_count} declared`);
    expect(render(<ServerManageMods />, serverContext({ ...server, mod_count: null }))).not.toContain("declared");
  });

  it("switches to the mods view on click", async () => {
    await setReadiness(null, false);
    const onViewChange = vi.fn();
    render(<ServerManageMods />, { ...serverContext(server), onViewChange });
    click("server.manageMods");
    expect(onViewChange).toHaveBeenCalledWith("mods");
  });

  it("ignores a label option and keeps 'Manage mods'", async () => {
    await setReadiness(null, false);
    expect(render(<ServerManageMods options={{ label: "Mods" }} />, serverContext(server))).toContain(
      'data-part="label">Manage mods</span>',
    );
  });
});

describe("ServerDeselect", () => {
  it("clears the selection when clicked", () => {
    useServerStore.setState({ selectedServer: server });
    render(<ServerDeselect />, serverContext(server));
    click("server.deselect");
    expect(useServerStore.getState().selectedServer).toBeNull();
  });

  it("reads Close details by default", () => {
    const html = render(<ServerDeselect />, serverContext(server));
    expect(html).toContain('aria-label="Close details"');
    expect(html).toContain('data-part="icon"');
  });
});

describe("ServerRefresh", () => {
  beforeEach(() => {
    useRowProbeStore.setState({ probingKey: null });
  });

  it("probes only this server, marking it busy until the probe settles", async () => {
    const { refreshVisibleServers } = await import("@/lib/tauri");
    let resolveProbe: () => void = () => {};
    vi.mocked(refreshVisibleServers).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProbe = () => resolve(undefined);
      }),
    );

    const html = render(<ServerRefresh />, serverContext(server));
    expect(click("server.refresh").stopPropagation).toHaveBeenCalled();

    expect(refreshVisibleServers).toHaveBeenCalledWith([{ addr: server.addr, query_port: server.query_port }], "row");
    expect(useRowProbeStore.getState().probingKey).toBe(`${server.addr}:${server.query_port}`);
    expect(html).not.toContain('data-state="busy"');

    resolveProbe();
    await Promise.resolve();
    await Promise.resolve();
    expect(useRowProbeStore.getState().probingKey).toBeNull();
  });

  it("marks the probing row busy and every other row disabled", () => {
    useRowProbeStore.setState({ probingKey: `${server.addr}:${server.query_port}` });
    expect(render(<ServerRefresh />, serverContext(server))).toContain('data-state="busy"');

    const other = render(<ServerRefresh />, serverContext(otherServer));
    expect(other).toContain('data-state="disabled"');
    expect(captured["server.refresh"].disabled).toBe(true);
  });
});

describe("ServerInfo", () => {
  it("defaults to icon-only with the launcher wording as aria-label and title", () => {
    const html = render(<ServerInfo />, serverContext(server));
    expect(html).toContain('aria-label="Server information"');
    expect(html).toContain('title="Server information"');
    expect(html).not.toContain('data-part="label"');
  });

  it("display: iconLabel shows the label part and drops the title", () => {
    const html = render(<ServerInfo options={{ display: "iconLabel" }} />, serverContext(server));
    expect(html).toContain('data-part="label">Server information</span>');
    expect(html).not.toContain("title=");
  });

  it("clicking calls openServerInfo with its subject server", () => {
    const openServerInfo = vi.fn();
    render(<ServerInfo />, { ...serverContext(server), openServerInfo });
    click("server.info");
    expect(openServerInfo).toHaveBeenCalledWith(server);
  });
});

describe("element icon and label options", () => {
  const iconOptionCases: { el: string; node: ReactNode; absent?: string }[] = [
    { el: "server.info", node: <ServerInfo options={{ icon: "x" }} /> },
    { el: "server.menu", node: <ServerMenu options={{ icon: "x" }} /> },
    { el: "server.menu serverLoad", node: <ServerMenu options={{ menu: "serverLoad", icon: "x" }} /> },
    { el: "server.favourite", node: <ServerFavourite options={{ icon: "x" }} /> },
    { el: "server.deselect", node: <ServerDeselect options={{ icon: "x" }} /> },
    { el: "server.manageMods", node: <ServerManageMods options={{ icon: "x" }} /> },
    { el: "server.gameTime", node: <ServerGameTime options={{ icon: "x" }} />, absent: "☀" },
  ];

  it.each(iconOptionCases)("$el swaps its own icon for the icon option", async ({ node, absent }) => {
    await setReadiness(null, false);
    const html = render(node, serverContext(server));
    expect(html).toContain("lucide-x");
    if (absent) expect(html).not.toContain(absent);
  });

  const labelOptionCases: { el: string; node: ReactNode; ariaLabel: string; title?: string }[] = [
    { el: "server.info", node: <ServerInfo options={{ label: "Row details" }} />, ariaLabel: "Row details" },
    { el: "server.menu", node: <ServerMenu options={{ label: "Row details" }} />, ariaLabel: "Row details", title: "Row details" },
  ];

  it.each(labelOptionCases)("$el reads its label option as the accessible name", ({ node, ariaLabel, title }) => {
    const html = render(node, serverContext(server));
    expect(html).toContain(`aria-label="${ariaLabel}"`);
    if (title) expect(html).toContain(`title="${title}"`);
  });
});

const uniqueSummary = { count: 2, total_size_bytes: 4_000_000 };
const unsubscribeOutcome = { count: 2, total_size_bytes: 4_000_000 };

describe("ServerCheckMods", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    useLaunchStore.setState({ notice: null });
  });

  it("calls checkServerMods for the subject server, marking its mods pending", async () => {
    const { checkServerMods } = await import("@/lib/tauri");
    let resolveCheck: (v: ServerModReadiness) => void = () => {};
    vi.mocked(checkServerMods).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    useServerStore.setState({ modPending: {} });

    render(<ServerCheckMods />, serverContext(server));
    const pending = click("server.checkMods").result as Promise<void>;

    expect(checkServerMods).toHaveBeenCalledWith(server.addr, server.query_port);

    resolveCheck(readiness([mod({ state: "not_subscribed" })]));
    await pending;

    expect(useServerStore.getState().modPending[server.addr]).toBe(true);
  });

  it("reports an error via the launch notice on failure", async () => {
    const { checkServerMods } = await import("@/lib/tauri");
    vi.mocked(checkServerMods).mockRejectedValueOnce(new Error("boom"));

    render(<ServerCheckMods />, serverContext(server));
    await click("server.checkMods").result;

    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "plain", text: "Error: boom" },
    });
  });
});

describe("ServerSubscribeAll", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    mockServerActions.dayzUp = false;
  });

  it("calls subscribeOnly with the subject server", () => {
    render(<ServerSubscribeAll />, serverContext(server));
    click("server.subscribeAll");
    expect(mockServerActions.subscribeOnly).toHaveBeenCalledWith(server);
  });

  it("marks this server's subscribe op busy and disables the button for any op", () => {
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "subscribing", note: null };
    const mine = render(<ServerSubscribeAll />, serverContext(server));
    expect(mine).toContain('data-state="busy"');
    expect(captured["server.subscribeAll"].disabled).toBe(true);

    mockServerActions.op = { addr: otherServer.addr, serverName: otherServer.name, phase: "subscribing", note: null };
    const other = render(<ServerSubscribeAll />, serverContext(server));
    expect(other).not.toContain('data-state="busy"');
    expect(other).toContain('data-state="disabled"');
  });
});

describe("ServerUnsubscribeUnique", () => {
  beforeEach(() => {
    mockServerActions.op = null;
    askConfirmCalls.length = 0;
    useLaunchStore.setState({ notice: null });
  });

  it("fetches the unique-mods summary, then confirms before unsubscribing", async () => {
    const { getUniqueModsSummary, unsubscribeUniqueMods } = await import("@/lib/tauri");
    vi.mocked(getUniqueModsSummary).mockResolvedValueOnce(uniqueSummary);
    vi.mocked(unsubscribeUniqueMods).mockResolvedValueOnce(unsubscribeOutcome);

    render(<ServerUnsubscribeUnique />, serverContext(server));
    await click("server.unsubscribeUnique").result;

    expect(getUniqueModsSummary).toHaveBeenCalledWith(server.addr, server.query_port);
    expect(unsubscribeUniqueMods).not.toHaveBeenCalled();
    expect(askConfirmCalls).toHaveLength(1);

    await askConfirmCalls[0].action();

    expect(unsubscribeUniqueMods).toHaveBeenCalledWith(server.addr, server.query_port);
    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: {
        kind: "plain",
        text: `Unsubscribed 2 unique mods (${formatBytes(unsubscribeOutcome.total_size_bytes, 1)})`,
      },
    });
  });

  it("never calls unsubscribeUniqueMods when the confirm is never resolved true", async () => {
    const { getUniqueModsSummary, unsubscribeUniqueMods } = await import("@/lib/tauri");
    vi.mocked(getUniqueModsSummary).mockResolvedValueOnce(uniqueSummary);

    render(<ServerUnsubscribeUnique />, serverContext(server));
    await click("server.unsubscribeUnique").result;

    expect(askConfirmCalls).toHaveLength(1);
    expect(unsubscribeUniqueMods).not.toHaveBeenCalled();
  });

  it("reports an error via the launch notice when the summary fetch fails", async () => {
    const { getUniqueModsSummary } = await import("@/lib/tauri");
    vi.mocked(getUniqueModsSummary).mockRejectedValueOnce(new Error("boom"));

    render(<ServerUnsubscribeUnique />, serverContext(server));
    await click("server.unsubscribeUnique").result;

    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "plain", text: "Error: boom" },
    });
    expect(askConfirmCalls).toHaveLength(0);
  });
});

describe("ServerCopyAddress", () => {
  beforeEach(async () => {
    const { copyServerAddress } = await import("@/lib/tauri");
    vi.mocked(copyServerAddress).mockResolvedValue(undefined);
    useLaunchStore.setState({ notice: null });
  });

  it("reads 'Copy address' by default, and the label option when given", () => {
    const value = serverContext(server);
    const idle = render(<ServerCopyAddress />, value);
    expect(idle).toContain(">Copy address<");
    expect(idle).not.toContain('data-state="copied"');

    expect(render(<ServerCopyAddress options={{ label: "Copy" }} />, value)).toContain(">Copy<");
  });

  it("calls copyServerAddress with the subject server, stopping propagation", async () => {
    const { copyServerAddress } = await import("@/lib/tauri");
    render(<ServerCopyAddress />, serverContext(server));
    expect(click("server.copyAddress").stopPropagation).toHaveBeenCalled();
    expect(copyServerAddress).toHaveBeenCalledWith(server);
  });

  it("schedules the copied-state reset 2s after a successful copy", async () => {
    const { copyServerAddress } = await import("@/lib/tauri");
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(global, "setTimeout");
      render(<ServerCopyAddress />, serverContext(server));
      click("server.copyAddress");

      await vi.advanceTimersByTimeAsync(0);
      expect(copyServerAddress).toHaveBeenCalledWith(server);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a failed copy as the server's notice", async () => {
    const { copyServerAddress } = await import("@/lib/tauri");
    vi.mocked(copyServerAddress).mockRejectedValueOnce(new Error("clipboard denied"));

    render(<ServerCopyAddress />, serverContext(server));
    click("server.copyAddress");
    await Promise.resolve();
    await Promise.resolve();

    expect(useLaunchStore.getState().notice).toEqual({
      addr: server.addr,
      notice: { kind: "plain", text: "Error: clipboard denied" },
    });
  });
});

describe("ServerModUpdate", () => {
  beforeEach(() => {
    useServerStore.setState({ modPending: {} });
  });

  it("renders nothing without a pending mod update for this server", () => {
    const value = serverContext(server);
    expect(render(<ServerModUpdate />, value)).toBe("");

    useServerStore.setState({ modPending: { [otherServer.addr]: true } });
    expect(render(<ServerModUpdate />, value)).toBe("");
  });

  it("renders UPDATE while this server has a pending mod update, honouring the label option", () => {
    useServerStore.setState({ modPending: { [server.addr]: true } });
    const value = serverContext(server);
    expect(render(<ServerModUpdate />, value)).toContain(">UPDATE<");
    expect(render(<ServerModUpdate options={{ label: "Update available" }} />, value)).toContain(">Update available<");
  });
});

describe("ServerAddress game port", () => {
  it("labels the game port instead of appending it to the query-port address", () => {
    const gamePortServer = { addr: "1.2.3.4:2303", game_port: 2302, online: true } as Server;
    const html = render(<ServerAddress options={{ showGamePort: true }} />, serverContext(gamePortServer));
    expect(html).toContain("1.2.3.4:2303");
    expect(html).toContain("game port 2302");
    expect(html).not.toContain(":2303:");
  });
});
