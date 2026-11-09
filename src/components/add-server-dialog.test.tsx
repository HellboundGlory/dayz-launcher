import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as AddServerStoreModule from "@/stores/add-server-store";
import type { Server } from "@/types/server";
import { useAddServerStore } from "@/stores/add-server-store";
import type { AddServerState } from "@/stores/add-server-store";
import { AddServerBox, AddServerDialog } from "./add-server-dialog";

const { verifyAndJoin } = vi.hoisted(() => ({
  verifyAndJoin: vi.fn<(server: Server) => Promise<void>>(),
}));

vi.mock("@/hooks/use-server-actions", () => ({ useServerActions: () => ({ verifyAndJoin }) }));

// SSR reads zustand's initial snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/add-server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof AddServerStoreModule>();
  return { ...actual, useAddServerStore: liveHook(actual.useAddServerStore) };
});

const server = {
  addr: "46.7.13.31:2303",
  query_port: 2303,
  game_port: 2302,
  name: "RED HORIZON | NEW SERVER",
  map_display: "Livonia",
  players: 13,
  max_players: 40,
  ping: 57,
  favourite: false,
} as Server;

const captured = new Map<string, Record<string, unknown>>();
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const part = props?.["data-part"];
      if (typeof part === "string") captured.set(part, props);
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

function box(overrides: Partial<Parameters<typeof AddServerBox>[0]> = {}) {
  return renderToStaticMarkup(
    <AddServerBox
      input="play.example.com"
      state="idle"
      server={null}
      message={null}
      favourite={false}
      busy={false}
      onInput={() => {}}
      onClear={() => {}}
      onLookup={() => {}}
      onCancel={() => {}}
      onFavourite={() => {}}
      onJoin={() => {}}
      {...overrides}
    />,
  );
}

describe("AddServerBox", () => {
  it("shows the title, the address field with its hint, and an empty result area while idle", () => {
    const html = box();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Add server"');
    expect(html).toContain("Add server");
    expect(html).toContain("Address");
    expect(html).toContain("An IP or a host name.");
    expect(captured.get("address")?.maxLength).toBe(255);
    expect(captured.get("address")?.autoFocus).toBe(true);
    expect(captured.get("result")?.content).toBeUndefined();
  });

  it("keeps one polite live region in every state, so changes are announced", () => {
    for (const state of ["idle", "searching", "notFound", "error"] as const) {
      expect(box({ state, message: "x" }).match(/aria-live="polite"/g)).toHaveLength(1);
    }
  });

  it("shows a refused favourite's message under the found server", () => {
    const html = box({ state: "found", server, message: "Couldn't add it to Favourites: refused" });
    expect(html).toContain("add it to Favourites: refused");
  });

  it("says it is looking while a lookup runs", () => {
    expect(box({ state: "searching" })).toContain("Looking…");
  });

  it("names the address that never answered, in the danger colour", () => {
    const html = box({ state: "notFound" });
    expect(html).toContain("Nothing answered at play.example.com. Check the address and the port.");
    expect(html).toContain("text-danger");
  });

  it("shows the command's own message on an error", () => {
    const html = box({ state: "error", message: "Could not find that host name" });
    expect(html).toContain("Could not find that host name");
    expect(html).toContain("text-danger");
  });

  it("shows the found server's name as text, its rows, and enables both footer buttons", () => {
    const html = box({ state: "found", server });

    expect(html).toContain("RED HORIZON | NEW SERVER");
    expect(html).toContain("Livonia");
    expect(html).toContain("13/40");
    expect(html).toContain("57 ms");
    expect(html).toContain("46.7.13.31:2303");
    expect(captured.get("favourite")?.disabled).toBe(false);
    expect(captured.get("join")?.disabled).toBe(false);
    expect(captured.get("status")?.["aria-live"]).toBe("polite");
  });

  it("renders a server name containing markup as text", () => {
    const html = box({ state: "found", server: { ...server, name: "<b>x</b>" } });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("disables the footer buttons until a server is found", () => {
    for (const state of ["idle", "searching", "notFound", "error"] as AddServerState[]) {
      captured.clear();
      box({ state });
      expect(captured.get("favourite")?.disabled, state).toBe(true);
      expect(captured.get("join")?.disabled, state).toBe(true);
    }
  });

  it("reads In favourites and stays disabled for a server already saved", () => {
    box({ state: "found", server, favourite: true });
    expect(captured.get("favourite")?.disabled).toBe(true);
  });
});

/** Opens the box and renders it, keeping the props of every `data-part` render. */
function mount() {
  useAddServerStore.setState({ open: true });
  captured.clear();
  const paint = () => renderToStaticMarkup(<AddServerDialog />);
  paint();
  return paint;
}

beforeEach(() => {
  verifyAndJoin.mockReset();
  useAddServerStore.setState({ open: false, input: "", state: "idle", server: null, message: null, busy: false });
});

afterEach(() => {
  useAddServerStore.setState({ open: false });
});

describe("AddServerDialog", () => {
  it("renders nothing until the + button asks for it", () => {
    expect(renderToStaticMarkup(<AddServerDialog />)).toBe("");
  });

  it("joins the found server once and closes", () => {
    useAddServerStore.setState({ open: true, state: "found", server, input: "play.example.com" });
    renderToStaticMarkup(<AddServerDialog />);

    (captured.get("join")?.onClick as () => void)();

    expect(verifyAndJoin).toHaveBeenCalledTimes(1);
    expect(verifyAndJoin).toHaveBeenCalledWith(server);
    expect(useAddServerStore.getState().open).toBe(false);
  });

  it("hands Escape and the scrim the same close", () => {
    mount();
    expect(useAddServerStore.getState().open).toBe(true);

    (captured.get("cancel")?.onClick as () => void)();
    expect(useAddServerStore.getState().open).toBe(false);
  });
});
