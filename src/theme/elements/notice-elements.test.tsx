import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerActionNotice, launchErrorMessage } from "./notice-elements";
import { useNoticeToasts } from "./notice-toasts";
import { ElementContextProvider, type ElementContextValue } from "./context";
import type { LaunchResult, Notice, ServerNotice } from "@/stores/launch-store";
import type { Server } from "@/types/server";
import type { Toast } from "@/stores/toast-store";

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

  it.each(["W02", "E01"] as const)("renders nothing in a row context for a %s notice", (code) => {
    setNotice(moddedServer.addr, { kind: "code", code });
    expect(render({ contextName: "row", selectedServer: moddedServer })).toBe("");
  });

  it.each([
    { code: "W02", state: "warning", message: "Downloads stalled" },
    { code: "E01", state: "error", message: "Could not subscribe" },
  ] as const)("renders a $code notice with data-state=$state outside a row", ({ code, state, message }) => {
    setNotice(moddedServer.addr, { kind: "code", code });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain('data-part="code"');
    expect(html).toContain(code);
    expect(html).toContain(message);
  });

  it("renders a success notice with data-state=success", () => {
    setNotice(moddedServer.addr, { kind: "plain", text: "Address copied", tone: "success" });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-state="success"');
    expect(html).toContain("Address copied");
  });

  it("renders nothing when the notice is tagged with a different server's addr", () => {
    setNotice(otherServer.addr, { kind: "code", code: "W02" });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toBe("");
  });

  it("renders a launch-result message with data-state=success", () => {
    setResult({ addr: moddedServer.addr, message: "Launched." });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-el="server.actionNotice"');
    expect(html).toContain('data-state="success"');
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Launched.");
    expect(html).not.toContain('data-part="title"');
    expect(html).not.toContain('data-part="code"');
  });

  it("renders a launch refusal with a title and the full error message", () => {
    setResult({ addr: moddedServer.addr, error: "Steam refused to launch DayZ." });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-state="error refused"');
    expect(html).toContain('data-part="title"');
    expect(html).toContain("Launch refused");
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Steam refused to launch DayZ.");
  });

  it("renders a plain notice with only a message part", () => {
    setNotice(moddedServer.addr, { kind: "plain", text: "Waiting for Steam." });
    const html = render({ contextName: "selection", selectedServer: moddedServer });
    expect(html).toContain('data-state="warning"');
    expect(html).toContain('data-part="message"');
    expect(html).toContain("Waiting for Steam.");
    expect(html).not.toContain('data-part="title"');
    expect(html).not.toContain('data-part="code"');
  });
});

/** The notices' current handovers, so a test can press what a toast press would. */
const closures: Record<string, (() => void) | undefined> = {};

function Toasts() {
  const toasts = useNoticeToasts();
  for (const toast of toasts) closures[toast.key] = toast.onClose;
  return (
    <div>
      {toasts.map((toast: Toast) => (
        <div
          key={toast.key}
          data-key={toast.key}
          data-tone={toast.tone}
          data-tag={toast.tag}
          data-title={toast.title}
          data-detail={toast.detail}
          data-quick={String(toast.quick === true)}
          data-closable={String(toast.closable !== false)}
          data-actions={(toast.actions ?? [])
            .map((action) => `${action.label}${action.primary ? "*" : ""}${action.disabled ? "!" : ""}`)
            .join("|")}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

const renderToasts = (value: Partial<ElementContextValue> = {}) =>
  renderToStaticMarkup(
    <ElementContextProvider value={value}>
      <Toasts />
    </ElementContextProvider>,
  );

describe("notice toasts", () => {
  it("says storage is running from memory, with no way to close it", () => {
    const html = renderToasts({ storageDegraded: true });
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('data-tag="Storage"');
    expect(html).toContain(
      "The server database could not be opened. Favourites and recent servers won&#x27;t be saved this session.",
    );
    expect(html).toContain('data-closable="false"');
  });

  it("hands the error's dismiss to the toast", () => {
    const dismissError = vi.fn();
    const html = renderToasts({ error: "Something broke.", dismissError });
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('data-tag="Error"');
    expect(html).toContain("Something broke.");
    expect(closures["notice:error:Something broke."]).toBe(dismissError);
  });

  it("offers Update and Later for a new version", () => {
    const dismissUpdateBanner = vi.fn();
    const openUpdateModal = vi.fn();
    const html = renderToasts({
      updateAvailable: { version: "2.7.0" },
      dismissUpdateBanner,
      openUpdateModal,
    });
    expect(html).toContain('data-tone="info"');
    expect(html).toContain('data-tag="Update"');
    expect(html).toContain("Tetra Launcher v2.7.0");
    expect(html).toContain("is ready to install.");
    expect(html).toContain('data-actions="Update*|Later"');
  });

  it("says nothing about an update that was dismissed", () => {
    expect(
      renderToasts({ updateAvailable: { version: "2.7.0" }, updateBannerDismissed: true }),
    ).not.toContain("2.7.0");
  });

  it("names the server on a join warning and keeps the code's detail", () => {
    serverState.servers = [moddedServer];
    setNotice(moddedServer.addr, { kind: "code", code: "W02" });
    const html = renderToasts();
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-tag="W02"');
    expect(html).toContain("DayZ Epoch Test");
    expect(html).toContain("Downloads stalled");
    expect(html).toContain("Steam pauses Workshop");
    expect(html).toContain('data-quick="false"');
  });

  it("shows a refusal as an error, even for a server no longer listed", () => {
    setResult({ addr: otherServer.addr, error: "DayZ is not installed" });
    const html = renderToasts();
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('data-tag="Launch refused"');
    expect(html).toContain("DayZ is not installed");
    expect(html).not.toContain("DayZ Epoch Test");
  });

  it("fades an action's success line but never reports a successful launch", () => {
    setNotice(moddedServer.addr, { kind: "plain", text: "Address copied", tone: "success" });
    const success = renderToasts();
    expect(success).toContain('data-tone="success"');
    expect(success).toContain('data-tag="Done"');
    expect(success).toContain("Address copied");
    expect(success).toContain('data-quick="true"');

    storeState.notice = null;
    setResult({ addr: moddedServer.addr, message: "Launched DayZ with 5 mods" });
    expect(renderToasts()).not.toContain("Launched DayZ");
  });

  it("reports the mods error and the cached list under their own tags", async () => {
    const html = await withModsStore({ error: "Steam refused.", fromCache: true }, () =>
      renderToasts(),
    );
    expect(html).toContain('data-tag="Mods"');
    expect(html).toContain("Steam refused.");
    expect(html).toContain('data-tag="Steam"');
    expect(html).toContain("Steam unreachable — showing last known mod list");
  });

  it("joins a verify result into one success line that clears all three results", async () => {
    const clearVerifyResult = vi.fn();
    const clearMutationFailures = vi.fn();
    const clearUniqueResult = vi.fn();
    await withModsStore(
      {
        verifyResult: { checked: 10, outdated: 2, queued: 2 },
        clearVerifyResult,
        clearMutationFailures,
        clearUniqueResult,
      },
      () => {
        const html = renderToasts();
        expect(html).toContain('data-tone="success"');
        expect(html).toContain('data-quick="true"');
        expect(html).toContain("10 checked · 2 outdated · 2 re-downloading");

        closures["notice:modsResult:10 checked · 2 outdated · 2 re-downloading"]?.();
        expect(clearVerifyResult).toHaveBeenCalledTimes(1);
        expect(clearMutationFailures).toHaveBeenCalledTimes(1);
        expect(clearUniqueResult).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("keeps a removal failure open and in the error tone", async () => {
    const html = await withModsStore({ mutationFailures: [["1", "Steam refused"]] }, () =>
      renderToasts(),
    );
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('data-quick="false"');
    expect(html).toContain("1 mod could not be removed: Steam refused");
  });

  it("says 'Removed ok' when a removal had no failures", async () => {
    const html = await withModsStore({ mutationFailures: [] }, () => renderToasts());
    expect(html).toContain('data-tone="success"');
    expect(html).toContain("Removed ok");
  });

  it.each([
    {
      result: { server: "DayZ Epoch", totalUnique: 0, selected: 0 },
      text: "No mods are unique to DayZ Epoch — every mod it uses is shared with another favourite/recent server.",
    },
    {
      result: { server: "DayZ Epoch", totalUnique: 2, selected: 0 },
      text: "2 mods are unique to DayZ Epoch, but none are in your subscribed library — nothing was selected.",
    },
    {
      result: { server: "DayZ Epoch", totalUnique: 1, selected: 1 },
      text: "1 unique mod for DayZ Epoch selected",
    },
    {
      result: { server: "DayZ Epoch", totalUnique: 3, selected: 2 },
      text: "2 of 3 unique mods for DayZ Epoch selected (1 not in your library)",
    },
  ])("words a select-unique outcome: $text", async ({ result, text }) => {
    const html = await withModsStore({ uniqueResult: result }, () => renderToasts());
    expect(html).toContain(text);
  });

  it("counts outdated mods and words the update button by what is running", async () => {
    const rows = [
      { workshop_id: "1", state: "needs_update", removed: false },
      { workshop_id: "2", state: "ready", removed: false },
    ];
    const idle = await withModsStore({ rows }, () => renderToasts());
    expect(idle).toContain('data-tag="Mods"');
    expect(idle).toContain('data-tone="warning"');
    expect(idle).toContain("1 mod needs updating");
    expect(idle).toContain('data-actions="Update all"');

    const busy = await withModsStore(
      { rows, op: { kind: "update", note: "UPDATING 1…" } },
      () => renderToasts(),
    );
    expect(busy).toContain('data-actions="UPDATING 1…!"');

    const unnamed = await withModsStore({ rows, op: { kind: "update", note: null } }, () =>
      renderToasts(),
    );
    expect(unnamed).toContain('data-actions="Updating…!"');
  });

  it("says nothing when no notice applies", () => {
    expect(renderToasts()).toBe("<div></div>");
  });
});

describe("launchErrorMessage", () => {
  it.each([
    ["TypeError: x is undefined", "Could not start DayZ. The launcher log has the details."],
    ["ReferenceError: y is not defined", "Could not start DayZ. The launcher log has the details."],
    ["Error: boom", "boom"],
    ["DayZ is already running.", "DayZ is already running."],
  ])("turns %j into %j", (raw, expected) => {
    expect(launchErrorMessage(raw)).toBe(expected);
  });
});
