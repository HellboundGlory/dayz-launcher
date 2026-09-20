import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Server } from "@/types/server";
import type { ModReadinessEntry, ServerModReadiness } from "@/types/server";
import { formatBytes } from "@/lib/utils";
import { ElementContextProvider, type ElementContextValue } from "./context";

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

vi.mock("@/hooks/use-server-actions", () => ({
  useServerActions: () => mockServerActions,
  phaseLabel: (op: { note: string | null }) => op.note ?? "DOWNLOADING…",
}));

vi.mock("./use-selection-readiness", () => ({
  useSelectionReadiness: vi.fn(),
}));

// Captures the props of the `data-el="server.join"` button as it is created,
// since renderToStaticMarkup discards event handlers from its HTML output.
let capturedJoinProps: Record<string, unknown> | null = null;

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (type === "button" && props["data-el"] === "server.join") {
        capturedJoinProps = props;
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
  capturedJoinProps = null;
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
    mockServerActions.verifyAndJoin.mockClear();
  });

  it("calls verifyAndJoin with the element's own subject server on click, after stopping propagation", async () => {
    await setReadiness(null, false);
    await render({ subjectContext: { kind: "server", data: server } });

    expect(capturedJoinProps).not.toBeNull();
    const onClick = capturedJoinProps!.onClick as (e: { stopPropagation: () => void }) => void;
    const stopPropagation = vi.fn();
    onClick({ stopPropagation });

    expect(stopPropagation).toHaveBeenCalled();
    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server);
  });

  it("calls verifyAndJoin with the row's own subject even when a different server is selected", async () => {
    await setReadiness(null, false);
    await render({ subjectContext: { kind: "server", data: server }, selectedServer: otherServer });

    const onClick = capturedJoinProps!.onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });

    expect(mockServerActions.verifyAndJoin).toHaveBeenCalledWith(server);
  });

  it("renders busy state and disables the button when this server has the active op", async () => {
    await setReadiness(null, false);
    mockServerActions.op = { addr: server.addr, serverName: server.name, phase: "downloading", note: "DOWNLOADING…" };
    const html = await render({ subjectContext: { kind: "server", data: server } });
    expect(html).toContain('data-state="busy"');
    expect(html).toContain("disabled");
    expect(html).toContain("DOWNLOADING…");
  });

  it("leaves the button enabled and unchanged when a different server has the active op", async () => {
    await setReadiness(null, false);
    mockServerActions.op = { addr: otherServer.addr, serverName: otherServer.name, phase: "downloading", note: "DOWNLOADING…" };
    const html = await render({ subjectContext: { kind: "server", data: server } });
    expect(html).not.toContain('data-state="busy"');
    expect(html).not.toContain("disabled");
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
