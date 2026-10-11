import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubscribedMod } from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import { ElementContextProvider } from "./context";
import type { ServerModData } from "./mod-elements";

// SSR takes zustand's initial-state snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

const tauriMocks = {
  openWorkshopInSteam: vi.fn(() => Promise.resolve()),
  openModFolder: vi.fn(() => Promise.resolve()),
  reinstallSubscribedMod: vi.fn(() => Promise.resolve()),
};

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, ...tauriMocks };
});

// Captures the props of interactive elements as they are created, keyed by
// `data-el`, since renderToStaticMarkup discards event handlers from its HTML output.
let captured: Record<string, Record<string, unknown>> = {};

function resetCaptured() {
  captured = {};
}

vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (type === "button" && props) {
        const key = props["data-el"] as string | undefined;
        if (key) captured[key] = props;
      }
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const makeMod = (id: string, overrides: Partial<SubscribedMod> = {}): SubscribedMod => ({
  workshop_id: id,
  title: `Mod ${id}`,
  state: "ready",
  size_on_disk: "100",
  time_updated: 1000,
  time_added_to_user_list: 1000,
  install_timestamp: 1000,
  description: "",
  folder: "",
  preview_url: null,
  tags: [],
  num_upvotes: 0,
  num_downvotes: 0,
  removed: false,
  locally_disabled: false,
  for_dayz: true,
  downloaded: null,
  total: null,
  workshop_url: null,
  consumer_app_id: null,
  time_created: 1000,
  file_size: 100,
  num_subscriptions: "0",
  score: 0,
  ...overrides,
});

async function withStore<T>(overrides: Record<string, unknown>, fn: () => T): Promise<T> {
  const { useModsStore } = await import("@/stores/mods-store");
  const prior = useModsStore.getState();
  useModsStore.setState({ ...prior, ...overrides });
  try {
    return fn();
  } finally {
    useModsStore.setState(prior, true);
  }
}

function renderWithMod(node: React.ReactNode, mod: SubscribedMod): string {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ subjectContext: { kind: "mod", data: mod } }}>
      {node}
    </ElementContextProvider>,
  );
}

function renderWithServer(node: React.ReactNode, srv: unknown): string {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ subjectContext: { kind: "modServer", data: srv } }}>
      {node}
    </ElementContextProvider>,
  );
}

function renderWithServerMod(node: React.ReactNode, mod: ServerModData): string {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ subjectContext: { kind: "serverMod", data: mod } }}>
      {node}
    </ElementContextProvider>,
  );
}

describe("ModSelect", () => {
  it("renders the checked and disabled states, toggles the selection on click and stops propagation", async () => {
    const { ModSelect } = await import("./mod-elements");
    const mod = makeMod("1");
    await withStore({ selectedIds: new Set() }, async () => {
      resetCaptured();
      const html = renderWithMod(<ModSelect />, mod);
      expect(html).toContain('aria-pressed="false"');
      expect(html).not.toContain('data-state="checked"');

      const { useModsStore } = await import("@/stores/mods-store");
      const onClick = captured["mod.select"].onClick as (e: { stopPropagation: () => void }) => void;
      const stopPropagation = vi.fn();
      onClick({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalled();
      expect(useModsStore.getState().selectedIds.has("1")).toBe(true);

      useModsStore.setState({ selectedIds: new Set(["1"]) });
      const checked = renderWithMod(<ModSelect />, makeMod("1", { locally_disabled: true }));
      expect(checked).toContain('aria-pressed="true"');
      expect(checked).toContain("disabled");
      expect(checked).toContain("checked");
    });
  });
});

describe("ModStatus", () => {
  it.each<[SubscribedMod["state"], string]>([
    ["ready", "Ready"],
    ["needs_update", "Update"],
    ["downloading", "Downloading"],
    ["not_installed", "Missing"],
    ["not_subscribed", "Not subscribed"],
    ["not_on_workshop", "Server-side"],
  ])("labels %s as %s", async (state, label) => {
    const { ModStatus } = await import("./mod-elements");
    expect(renderWithMod(<ModStatus />, makeMod("1", { state }))).toContain(`>${label}<`);
  });

  it("shows a width-styled progress part only while downloading with a known total", async () => {
    const { ModStatus } = await import("./mod-elements");
    const mod = makeMod("1", { state: "downloading" });
    await withStore({ progress: { "1": { downloaded: "500000", total: "1000000" } } }, () => {
      const known = renderWithMod(<ModStatus />, mod);
      expect(known).toContain(">Downloading<");
      expect(known).toContain('data-part="progress"');
      expect(known).toContain("width:50%");
    });
    const unknown = renderWithMod(<ModStatus />, mod);
    expect(unknown).toContain("Downloading");
    expect(unknown).not.toContain('data-part="progress"');
  });

  it("lets a live state override the row state, but never downgrades a needs_update row to ready", async () => {
    const { ModStatus } = await import("./mod-elements");
    await withStore({ states: { "1": "ready" } }, () => {
      const html = renderWithMod(<ModStatus />, makeMod("1", { state: "needs_update" }));
      expect(html).toContain(">Update<");
      expect(html).toContain("update");
    });
    await withStore({ states: { "1": "downloading" } }, () => {
      expect(renderWithMod(<ModStatus />, makeMod("1", { state: "ready" }))).toContain("Downloading");
    });
  });
});

describe("ModThumbnail", () => {
  it("renders the preview image, or the placeholder part and missing state without one", async () => {
    const { ModThumbnail } = await import("./mod-elements");
    const withPreview = renderWithMod(<ModThumbnail />, makeMod("1", { preview_url: "https://example.com/a.png" }));
    expect(withPreview).toContain('data-part="image"');
    expect(withPreview).not.toContain("missing");

    const withoutPreview = renderWithMod(<ModThumbnail />, makeMod("1", { preview_url: null }));
    expect(withoutPreview).toContain('data-part="placeholder"');
    expect(withoutPreview).toContain("missing");
  });
});

describe("ModName", () => {
  it("falls back to the workshop id when there's no title", async () => {
    const { ModName } = await import("./mod-elements");
    expect(renderWithMod(<ModName />, makeMod("1", { title: null }))).toContain("1");
  });
});

describe("ModDisabledBadge", () => {
  it("renders only for a locally-disabled mod, honouring a custom label", async () => {
    const { ModDisabledBadge } = await import("./mod-elements");
    expect(renderWithMod(<ModDisabledBadge />, makeMod("1", { locally_disabled: false }))).toBe("");
    const html = renderWithMod(<ModDisabledBadge options={{ label: "Off" }} />, makeMod("2", { locally_disabled: true }));
    expect(html).toContain("Off");
  });
});

describe("ModTags", () => {
  it("joins up to three tags as text, falls back to the workshop id, and renders chips for limit: all", async () => {
    const { ModTags } = await import("./mod-elements");
    const tags = makeMod("1", { tags: ["alpha", "bravo", "charlie", "delta"] });
    const text = renderWithMod(<ModTags />, tags);
    expect(text).toContain("alpha · bravo · charlie");
    expect(text).not.toContain("delta");

    expect(renderWithMod(<ModTags />, makeMod("42", { tags: [] }))).toContain("42");

    const chips = renderWithMod(<ModTags options={{ style: "chips", limit: "all" }} />, tags);
    expect(chips.match(/data-part="chip"/g)?.length).toBe(4);
  });
});

describe("ModSize", () => {
  it("formats the disk size to one decimal place, or shows an em-dash with the unknown state", async () => {
    const { ModSize } = await import("./mod-elements");
    const missing = renderWithMod(<ModSize />, makeMod("1", { size_on_disk: "0" }));
    expect(missing).toContain("—");
    expect(missing).toContain("unknown");

    expect(renderWithMod(<ModSize />, makeMod("1", { size_on_disk: "123456" }))).toContain(formatBytes(123456, 1));
  });
});

describe("ModPublishedSize", () => {
  it("formats the published Workshop size, or shows an em-dash with the unknown state", async () => {
    const { ModPublishedSize } = await import("./mod-elements");
    const missing = renderWithMod(<ModPublishedSize />, makeMod("1", { file_size: 0 }));
    expect(missing).toContain("—");
    expect(missing).toContain("unknown");

    expect(renderWithMod(<ModPublishedSize />, makeMod("1", { file_size: 654321 }))).toContain(formatBytes(654321, 1));
  });
});

describe("ModUpdated / ModSubscribed / ModCreated", () => {
  it.each(["ModUpdated", "ModSubscribed", "ModCreated"] as const)(
    "%s shows the em-dash and unknown state when its timestamp is missing",
    async (name) => {
      const El = (await import("./mod-elements"))[name];
      const mod = makeMod("1", { time_updated: 0, time_added_to_user_list: 0, install_timestamp: 0, time_created: 0 });
      const html = renderWithMod(<El />, mod);
      expect(html).toContain("—");
      expect(html).toContain("unknown");
    },
  );

  it("mod.subscribed falls back to install_timestamp when never added to the user list", async () => {
    const { ModSubscribed } = await import("./mod-elements");
    const mod = makeMod("1", { time_added_to_user_list: 0, install_timestamp: 500 });
    expect(renderWithMod(<ModSubscribed />, mod)).not.toContain("unknown");
  });

  it("mod.created defaults to date formatting, mod.updated to relative", async () => {
    const { ModCreated, ModUpdated } = await import("./mod-elements");
    const ts = Math.floor(Date.now() / 1000) - 120;
    const mod = makeMod("1", { time_created: ts, time_updated: ts });
    expect(renderWithMod(<ModCreated />, mod)).toContain(new Date(ts * 1000).toLocaleDateString());
    expect(renderWithMod(<ModUpdated />, mod)).toContain("ago");
  });
});

describe("ModSubscribers", () => {
  it("localises the count, or shows an em-dash with the unknown state without one", async () => {
    const { ModSubscribers } = await import("./mod-elements");
    const missing = renderWithMod(<ModSubscribers />, makeMod("1", { num_subscriptions: "0" }));
    expect(missing).toContain("—");
    expect(missing).toContain("unknown");

    expect(renderWithMod(<ModSubscribers />, makeMod("1", { num_subscriptions: "1234" }))).toContain(
      (1234).toLocaleString(),
    );
  });
});

describe("ModRating", () => {
  it("renders an em-dash with no votes, else the up/down parts", async () => {
    const { ModRating } = await import("./mod-elements");
    expect(renderWithMod(<ModRating />, makeMod("1"))).toContain("—");

    const html = renderWithMod(<ModRating />, makeMod("1", { num_upvotes: 12, num_downvotes: 3 }));
    expect(html).toContain('data-part="up"');
    expect(html).toContain("12▲");
    expect(html).toContain('data-part="down"');
    expect(html).toContain("3▼");
  });
});

describe("ModWorkshopId", () => {
  it("renders the workshop id as text", async () => {
    const { ModWorkshopId } = await import("./mod-elements");
    expect(renderWithMod(<ModWorkshopId />, makeMod("123456789"))).toContain("123456789");
  });
});

describe("ModFolder", () => {
  it("renders the folder name, or an em-dash with the unknown state without one", async () => {
    const { ModFolder } = await import("./mod-elements");
    const missing = renderWithMod(<ModFolder />, makeMod("1", { folder: null }));
    expect(missing).toContain("—");
    expect(missing).toContain("unknown");

    expect(renderWithMod(<ModFolder />, makeMod("1", { folder: "@MyMod" }))).toContain("@MyMod");
  });
});

describe("ModDescription", () => {
  it("clamps to 6 lines by default, marks the empty state and drops the clamp variable for clamp: none", async () => {
    const { ModDescription } = await import("./mod-elements");
    expect(renderWithMod(<ModDescription />, makeMod("1", { description: "" }))).toContain("empty");

    const text = makeMod("1", { description: "Some text" });
    expect(renderWithMod(<ModDescription />, text)).toContain("--t-line-clamp:6");
    expect(renderWithMod(<ModDescription options={{ clamp: "none" }} />, text)).not.toContain("--t-line-clamp");
  });
});

describe("ModUpdate", () => {
  it("renders nothing unless the mod needs an update, then calls updateMods for it on click", async () => {
    const { ModUpdate } = await import("./mod-elements");
    expect(renderWithMod(<ModUpdate />, makeMod("1", { state: "ready" }))).toBe("");

    const updateMods = vi.fn();
    await withStore({ updateMods }, () => {
      resetCaptured();
      const html = renderWithMod(<ModUpdate />, makeMod("1", { state: "needs_update" }));
      expect(html).toContain("Update");
      const onClick = captured["mod.update"].onClick as (e: { stopPropagation: () => void }) => void;
      const stopPropagation = vi.fn();
      onClick({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalled();
      expect(updateMods).toHaveBeenCalledWith(["1"]);
    });
  });

  it("shows the busy and disabled state while an update is in flight", async () => {
    const { ModUpdate } = await import("./mod-elements");
    await withStore({ op: { kind: "update", note: null } }, () => {
      const html = renderWithMod(<ModUpdate />, makeMod("1", { state: "needs_update" }));
      expect(html).toContain("busy");
      expect(html).toContain("disabled");
    });
  });
});

describe("ModOpenInSteam", () => {
  it("calls openWorkshopInSteam with the workshop id and stops propagation", async () => {
    await withStore({}, async () => {
      const { ModOpenInSteam } = await import("./mod-elements");
      resetCaptured();
      renderWithMod(<ModOpenInSteam />, makeMod("42"));
      const onClick = captured["mod.openInSteam"].onClick as (e: { stopPropagation: () => void }) => void;
      const stopPropagation = vi.fn();
      onClick({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalled();
      expect(tauriMocks.openWorkshopInSteam).toHaveBeenCalledWith("42");
    });
  });
});

describe("ModOpenFolder", () => {
  it("is disabled without a folder, and opens the mod's folder when present", async () => {
    const { ModOpenFolder } = await import("./mod-elements");
    resetCaptured();
    const missing = renderWithMod(<ModOpenFolder />, makeMod("1", { folder: null }));
    expect(missing).toContain("disabled");
    (captured["mod.openFolder"].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(tauriMocks.openModFolder).not.toHaveBeenCalled();

    resetCaptured();
    const present = renderWithMod(<ModOpenFolder />, makeMod("1", { folder: "@MyMod" }));
    expect(present).not.toContain("disabled");
    (captured["mod.openFolder"].onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(tauriMocks.openModFolder).toHaveBeenCalledWith("@MyMod");
  });
});

describe("ModReinstall", () => {
  it("calls reinstallSubscribedMod with the workshop id and stops propagation", async () => {
    const { ModReinstall } = await import("./mod-elements");
    resetCaptured();
    expect(renderWithMod(<ModReinstall />, makeMod("7"))).not.toContain("busy");

    const onClick = captured["mod.reinstall"].onClick as (e: { stopPropagation: () => void }) => void;
    const stopPropagation = vi.fn();
    onClick({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
    expect(tauriMocks.reinstallSubscribedMod).toHaveBeenCalledWith("7");
  });
});

describe("ModDeselect", () => {
  it("clears the open mod on click and stops propagation", async () => {
    const { ModDeselect } = await import("./mod-elements");
    const { useModsStore } = await import("@/stores/mods-store");
    await withStore({ selectedModId: "1" }, () => {
      resetCaptured();
      renderWithMod(<ModDeselect />, makeMod("1"));
      const onClick = captured["mod.deselect"].onClick as (e: { stopPropagation: () => void }) => void;
      const stopPropagation = vi.fn();
      onClick({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalled();
      expect(useModsStore.getState().selectedModId).toBeNull();
    });
  });
});

describe("ModNeededBy", () => {
  it("renders nothing when no server needs the mod, else the label and count", async () => {
    const { ModNeededBy } = await import("./mod-elements");
    await withStore({ needing: [] }, () => {
      expect(renderWithMod(<ModNeededBy />, makeMod("1"))).toBe("");
    });
    await withStore(
      {
        needing: [
          { addr: "1.2.3.4", query_port: 2305, name: "Server A", last_played: 100 },
          { addr: "5.6.7.8", query_port: 2305, name: "Server B", last_played: null },
        ],
      },
      () => {
        const html = renderWithMod(<ModNeededBy />, makeMod("1"));
        expect(html).toContain("Needed by");
        expect(html).toContain(">2<");
      },
    );
  });
});

describe("ModServer displays", () => {
  it("modServer.name falls back to addr:port without a name, and address always renders it", async () => {
    const { ModServerName, ModServerAddress } = await import("./mod-elements");
    const unnamed = { addr: "1.2.3.4", query_port: 2305, name: "", last_played: null };
    expect(renderWithServer(<ModServerName />, unnamed)).toContain("1.2.3.4:2305");
    const named = { ...unnamed, name: "Server A" };
    expect(renderWithServer(<ModServerAddress />, named)).toContain("1.2.3.4:2305");
  });

  it("modServer.lastPlayed reads never without a timestamp, and a relative time otherwise", async () => {
    const { ModServerLastPlayed } = await import("./mod-elements");
    const never = renderWithServer(<ModServerLastPlayed />, {
      addr: "1.2.3.4",
      query_port: 2305,
      name: "Server A",
      last_played: null,
    });
    expect(never).toContain("never");
    expect(never).toContain('data-state="never"');

    const played = renderWithServer(<ModServerLastPlayed />, {
      addr: "1.2.3.4",
      query_port: 2305,
      name: "Server A",
      last_played: Math.floor(Date.now() / 1000) - 120,
    });
    expect(played).toContain("ago");
    expect(played).not.toContain('data-state="never"');
  });
});

describe("serverMod elements", () => {
  describe("ServerModOrder", () => {
    it("renders the mod's 1-based position in the server's list, or an em-dash without one", async () => {
      const { ServerModOrder } = await import("./mod-elements");
      expect(renderWithServerMod(<ServerModOrder />, { workshop_id: "2", order: 2 })).toContain('data-part="value">2<');
      expect(renderWithServerMod(<ServerModOrder />, { workshop_id: "2" })).toContain('data-part="value">—<');
    });
  });

  describe("ServerModThumbnail", () => {
    it("renders the preview image, or the missing state without a preview url", async () => {
      const { ServerModThumbnail } = await import("./mod-elements");
      const present = renderWithServerMod(<ServerModThumbnail />, { preview_url: "https://example.com/x.jpg" });
      expect(present).toContain("https://example.com/x.jpg");
      expect(present).not.toContain('data-state="missing"');

      const missing = renderWithServerMod(<ServerModThumbnail />, { preview_url: null });
      expect(missing).toContain('data-state="missing"');
      expect(missing).not.toContain("<img");
    });
  });

  describe("ServerModProgress", () => {
    it("renders nothing while not downloading", async () => {
      const { ServerModProgress } = await import("./mod-elements");
      expect(renderWithServerMod(<ServerModProgress />, { state: "ready" })).toBe("");
    });

    it("is indeterminate until Steam reports a total, then shows the bar width and the sizes", async () => {
      const { ServerModProgress } = await import("./mod-elements");
      const indeterminate = renderWithServerMod(<ServerModProgress />, {
        state: "downloading",
        downloaded_bytes: 1024,
        total_bytes: null,
      });
      expect(indeterminate).toContain('data-state="indeterminate"');

      const known = renderWithServerMod(<ServerModProgress />, {
        state: "downloading",
        downloaded_bytes: 50 * 1024 * 1024,
        total_bytes: 100 * 1024 * 1024,
      });
      expect(known).not.toContain('data-state="indeterminate"');
      expect(known).toContain("width:50%");
      expect(known).toContain(`${formatBytes(50 * 1024 * 1024, 1)} / ${formatBytes(100 * 1024 * 1024, 1)}`);
    });
  });

  describe("ServerModUnique", () => {
    it("renders nothing unless the mod is unique, else the default or given label", async () => {
      const { ServerModUnique } = await import("./mod-elements");
      expect(renderWithServerMod(<ServerModUnique />, { is_unique: false })).toBe("");
      expect(renderWithServerMod(<ServerModUnique />, { is_unique: true })).toContain("Only this server");
      expect(renderWithServerMod(<ServerModUnique options={{ label: "Unique" }} />, { is_unique: true })).toContain(
        ">Unique<",
      );
    });
  });

  describe("ServerModOpenInSteam", () => {
    it("calls openWorkshopInSteam with the workshop id and stops propagation", async () => {
      const { ServerModOpenInSteam } = await import("./mod-elements");
      resetCaptured();
      renderWithServerMod(<ServerModOpenInSteam />, { workshop_id: "77", state: "ready" });
      const onClick = captured["serverMod.openInSteam"].onClick as (e: { stopPropagation: () => void }) => void;
      const stopPropagation = vi.fn();
      onClick({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalled();
      expect(tauriMocks.openWorkshopInSteam).toHaveBeenCalledWith("77");
    });

    it("is disabled for server-side mods and never calls openWorkshopInSteam", async () => {
      const { ServerModOpenInSteam } = await import("./mod-elements");
      resetCaptured();
      const html = renderWithServerMod(<ServerModOpenInSteam />, { workshop_id: "77", state: "not_on_workshop" });
      expect(html).toContain("disabled");
      (captured["serverMod.openInSteam"].onClick as (e: { stopPropagation: () => void }) => void)({
        stopPropagation: vi.fn(),
      });
      expect(tauriMocks.openWorkshopInSteam).not.toHaveBeenCalled();
    });
  });

  describe("ServerModState", () => {
    const cases: { state?: string; wording: string; name: string }[] = [
      { state: "ready", wording: "Ready", name: "ready" },
      { state: "needs_update", wording: "Needs update", name: "needsUpdate" },
      { state: "downloading", wording: "Downloading", name: "downloading" },
      { state: "not_installed", wording: "Not installed", name: "notInstalled" },
      { state: "not_subscribed", wording: "Not subscribed", name: "notSubscribed" },
      { state: "not_on_workshop", wording: "Unlisted", name: "serverSide" },
      { wording: "Checking…", name: "checking" },
    ];

    it.each(cases)("renders the dot and the wording for $name", async ({ state, wording, name }) => {
      const { ServerModState } = await import("./mod-elements");
      const html = renderWithServerMod(<ServerModState />, { state });
      expect(html).toContain(`data-state="${name}"`);
      expect(html).toContain('data-part="dot"');
      expect(html).toContain('data-part="label"');
      expect(html).toContain(wording);
    });

    it("renders dot-only with the wording as its role=img label, label-only, or a custom label", async () => {
      const { ServerModState } = await import("./mod-elements");
      const dot = renderWithServerMod(<ServerModState options={{ display: "dot" }} />, { state: "ready" });
      expect(dot).toContain('data-state="ready"');
      expect(dot).toContain('data-part="dot"');
      expect(dot).not.toContain('data-part="label"');
      expect(dot).toContain('role="img"');
      expect(dot).toContain('aria-label="Ready"');

      const labelOnly = renderWithServerMod(<ServerModState options={{ display: "label" }} />, { state: "ready" });
      expect(labelOnly).not.toContain('data-part="dot"');
      expect(labelOnly).toContain('data-part="label"');

      const custom = renderWithServerMod(<ServerModState options={{ label: "Ready to go" }} />, { state: "ready" });
      expect(custom).toContain("Ready to go");
    });
  });

  describe("ServerModSize", () => {
    const text = (html: string) => html.replace(/<[^>]*>/g, "");
    const cases: { name: string; mod: ServerModData; wording: string; state?: string; qualifier?: boolean }[] = [
      { name: "missing", mod: { state: "not_installed", size_bytes: 1024, size_is_upper_bound: false }, wording: "1 KB" },
      {
        name: "unsubscribed",
        mod: { state: "not_subscribed", size_bytes: 1024, size_is_upper_bound: false },
        wording: "1 KB",
      },
      {
        name: "upper bound",
        mod: { state: "not_installed", size_bytes: 1280, size_is_upper_bound: true },
        wording: `up to ${formatBytes(1280, 1)}`,
        state: "upperBound",
        qualifier: true,
      },
      { name: "unlisted", mod: { state: "not_on_workshop", size_bytes: 1280 }, wording: formatBytes(1280, 1) },
      {
        name: "needs update",
        mod: { state: "needs_update", size_bytes: 4096, size_is_upper_bound: false },
        wording: "4 KB",
      },
      { name: "ready", mod: { state: "ready", size_bytes: null }, wording: "" },
      { name: "unknown size", mod: { state: "not_installed", size_bytes: null }, wording: "—", state: "unknown" },
    ];

    it.each(cases)("shows the size text, state and qualifier for $name", async (c) => {
      const { ServerModSize } = await import("./mod-elements");
      const html = renderWithServerMod(<ServerModSize />, c.mod);
      expect(text(html)).toBe(c.wording);
      if (c.wording) expect(html).toContain(`data-part="value">${c.wording.replace(/^up to /, "")}<`);
      expect(html.includes('data-part="qualifier"')).toBe(!!c.qualifier);
      if (c.state) expect(html).toContain(`data-state="${c.state}"`);
      else expect(html).not.toContain("data-state=");
    });
  });
});
