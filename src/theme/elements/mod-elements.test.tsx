import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubscribedMod } from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import { ElementContextProvider, type ElementContextValue } from "./context";

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

function renderWithMod(node: React.ReactNode, mod: SubscribedMod, value?: Partial<ElementContextValue>): string {
  return renderToStaticMarkup(
    <ElementContextProvider value={{ subjectContext: { kind: "mod", data: mod }, ...value }}>
      {node}
    </ElementContextProvider>,
  );
}

describe("ModSelect", () => {
  it("renders unchecked, toggles selection on click and stops propagation, without opening the row", async () => {
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
    });
  });

  it("renders checked when selected, and marks disabled state for a locally-disabled mod", async () => {
    const { ModSelect } = await import("./mod-elements");
    const mod = makeMod("1", { locally_disabled: true });
    await withStore({ selectedIds: new Set(["1"]) }, () => {
      const html = renderWithMod(<ModSelect />, mod);
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain("disabled");
      expect(html).toContain("checked");
    });
  });
});

describe("ModStatus", () => {
  it("labels each registry state", async () => {
    const { ModStatus } = await import("./mod-elements");
    const cases: [SubscribedMod["state"], string][] = [
      ["ready", "Installed"],
      ["needs_update", "Update available"],
      ["not_installed", "Not downloaded"],
      ["not_subscribed", "Not subscribed"],
      ["not_on_workshop", "Server-side"],
    ];
    for (const [state, label] of cases) {
      const mod = makeMod("1", { state });
      const html = renderWithMod(<ModStatus />, mod);
      expect(html).toContain(label);
    }
  });

  it("shows byte progress and a width-styled progress part while downloading with a known total", async () => {
    const { ModStatus } = await import("./mod-elements");
    const mod = makeMod("1", { state: "downloading" });
    await withStore({ progress: { "1": { downloaded: "500000", total: "1000000" } } }, () => {
      const html = renderWithMod(<ModStatus />, mod);
      expect(html).toContain(`${formatBytes(500000, 1)} / ${formatBytes(1000000, 1)}`);
      expect(html).toContain('data-part="progress"');
      expect(html).toContain("width:50%");
    });
  });

  it("omits the progress part while downloading with no known total", async () => {
    const { ModStatus } = await import("./mod-elements");
    const mod = makeMod("1", { state: "downloading" });
    const html = renderWithMod(<ModStatus />, mod);
    expect(html).toContain("Downloading");
    expect(html).not.toContain('data-part="progress"');
  });

  it("never lets a live 'ready' poll downgrade an authoritative needs_update row", async () => {
    const { ModStatus } = await import("./mod-elements");
    const mod = makeMod("1", { state: "needs_update" });
    await withStore({ states: { "1": "ready" } }, () => {
      const html = renderWithMod(<ModStatus />, mod);
      expect(html).toContain("Update available");
      expect(html).toContain("update");
    });
  });

  it("lets a live downloading state override the row state", async () => {
    const { ModStatus } = await import("./mod-elements");
    const mod = makeMod("1", { state: "ready" });
    await withStore({ states: { "1": "downloading" } }, () => {
      const html = renderWithMod(<ModStatus />, mod);
      expect(html).toContain("Downloading");
    });
  });
});

describe("ModThumbnail", () => {
  it("renders the preview image part when present", async () => {
    const { ModThumbnail } = await import("./mod-elements");
    const mod = makeMod("1", { preview_url: "https://example.com/a.png" });
    const html = renderWithMod(<ModThumbnail />, mod);
    expect(html).toContain('data-part="image"');
    expect(html).not.toContain("missing");
  });

  it("renders the placeholder part and 'missing' state without a preview", async () => {
    const { ModThumbnail } = await import("./mod-elements");
    const mod = makeMod("1", { preview_url: null });
    const html = renderWithMod(<ModThumbnail />, mod);
    expect(html).toContain('data-part="placeholder"');
    expect(html).toContain("missing");
  });
});

describe("ModName", () => {
  it("falls back to the workshop id when there's no title", async () => {
    const { ModName } = await import("./mod-elements");
    const mod = makeMod("1", { title: null });
    const html = renderWithMod(<ModName />, mod);
    expect(html).toContain("1");
  });
});

describe("ModDisabledBadge", () => {
  it("renders only for a locally-disabled mod, honouring a custom label", async () => {
    const { ModDisabledBadge } = await import("./mod-elements");
    const enabled = makeMod("1", { locally_disabled: false });
    const disabled = makeMod("2", { locally_disabled: true });
    expect(renderWithMod(<ModDisabledBadge />, enabled)).toBe("");
    const html = renderWithMod(<ModDisabledBadge options={{ label: "Off" }} />, disabled);
    expect(html).toContain("Off");
  });
});

describe("ModTags", () => {
  it("joins tags as text by default, limited to 3", async () => {
    const { ModTags } = await import("./mod-elements");
    const mod = makeMod("1", { tags: ["alpha", "bravo", "charlie", "delta"] });
    const html = renderWithMod(<ModTags />, mod);
    expect(html).toContain("alpha · bravo · charlie");
    expect(html).not.toContain("delta");
  });

  it("falls back to the workshop id when there are no tags", async () => {
    const { ModTags } = await import("./mod-elements");
    const mod = makeMod("42", { tags: [] });
    const html = renderWithMod(<ModTags />, mod);
    expect(html).toContain("42");
  });

  it("renders chip parts and honours limit: all", async () => {
    const { ModTags } = await import("./mod-elements");
    const mod = makeMod("1", { tags: ["a", "b", "c", "d"] });
    const html = renderWithMod(<ModTags options={{ style: "chips", limit: "all" }} />, mod);
    expect(html.match(/data-part="chip"/g)?.length).toBe(4);
  });
});

describe("ModSize", () => {
  it("shows the em-dash and unknown state without a size", async () => {
    const { ModSize } = await import("./mod-elements");
    const mod = makeMod("1", { size_on_disk: "0" });
    const html = renderWithMod(<ModSize />, mod);
    expect(html).toContain("—");
    expect(html).toContain("unknown");
  });

  it("formats bytes to one decimal place", async () => {
    const { ModSize } = await import("./mod-elements");
    const mod = makeMod("1", { size_on_disk: "123456" });
    const html = renderWithMod(<ModSize />, mod);
    expect(html).toContain(formatBytes(123456, 1));
  });
});

describe("ModPublishedSize", () => {
  it("shows the em-dash and unknown state without a published size", async () => {
    const { ModPublishedSize } = await import("./mod-elements");
    const mod = makeMod("1", { file_size: 0 });
    const html = renderWithMod(<ModPublishedSize />, mod);
    expect(html).toContain("—");
    expect(html).toContain("unknown");
  });

  it("formats the published Workshop download size", async () => {
    const { ModPublishedSize } = await import("./mod-elements");
    const mod = makeMod("1", { file_size: 654321 });
    const html = renderWithMod(<ModPublishedSize />, mod);
    expect(html).toContain(formatBytes(654321, 1));
  });
});

describe("ModUpdated / ModSubscribed / ModCreated", () => {
  it("show the em-dash and unknown state when their timestamp is missing", async () => {
    const { ModUpdated, ModSubscribed, ModCreated } = await import("./mod-elements");
    const mod = makeMod("1", { time_updated: 0, time_added_to_user_list: 0, install_timestamp: 0, time_created: 0 });
    for (const El of [ModUpdated, ModSubscribed, ModCreated]) {
      const html = renderWithMod(<El />, mod);
      expect(html).toContain("—");
      expect(html).toContain("unknown");
    }
  });

  it("mod.subscribed falls back to install_timestamp when never added to the user list", async () => {
    const { ModSubscribed } = await import("./mod-elements");
    const mod = makeMod("1", { time_added_to_user_list: 0, install_timestamp: 500 });
    const html = renderWithMod(<ModSubscribed />, mod);
    expect(html).not.toContain("unknown");
  });

  it("mod.created defaults to date formatting, mod.updated to relative", async () => {
    const { ModCreated, ModUpdated } = await import("./mod-elements");
    const ts = Math.floor(Date.now() / 1000) - 120;
    const mod = makeMod("1", { time_created: ts, time_updated: ts });
    const created = renderWithMod(<ModCreated />, mod);
    const updated = renderWithMod(<ModUpdated />, mod);
    expect(created).toContain(new Date(ts * 1000).toLocaleDateString());
    expect(updated).toContain("ago");
  });
});

describe("ModSubscribers", () => {
  it("shows the em-dash and unknown state without a subscriber count", async () => {
    const { ModSubscribers } = await import("./mod-elements");
    const mod = makeMod("1", { num_subscriptions: "0" });
    const html = renderWithMod(<ModSubscribers />, mod);
    expect(html).toContain("—");
    expect(html).toContain("unknown");
  });

  it("localises the subscriber count", async () => {
    const { ModSubscribers } = await import("./mod-elements");
    const mod = makeMod("1", { num_subscriptions: "1234" });
    const html = renderWithMod(<ModSubscribers />, mod);
    expect(html).toContain((1234).toLocaleString());
  });
});

describe("ModRating", () => {
  it("shows an em-dash when there are no votes", async () => {
    const { ModRating } = await import("./mod-elements");
    const mod = makeMod("1", { num_upvotes: 0, num_downvotes: 0 });
    const html = renderWithMod(<ModRating />, mod);
    expect(html).toContain("—");
  });

  it("renders up/down parts", async () => {
    const { ModRating } = await import("./mod-elements");
    const mod = makeMod("1", { num_upvotes: 12, num_downvotes: 3 });
    const html = renderWithMod(<ModRating />, mod);
    expect(html).toContain('data-part="up"');
    expect(html).toContain("12▲");
    expect(html).toContain('data-part="down"');
    expect(html).toContain("3▼");
  });
});

describe("ModWorkshopId", () => {
  it("renders the workshop id as text", async () => {
    const { ModWorkshopId } = await import("./mod-elements");
    const mod = makeMod("123456789");
    const html = renderWithMod(<ModWorkshopId />, mod);
    expect(html).toContain("123456789");
  });
});

describe("ModFolder", () => {
  it("shows the em-dash and unknown state without a folder", async () => {
    const { ModFolder } = await import("./mod-elements");
    const mod = makeMod("1", { folder: null });
    const html = renderWithMod(<ModFolder />, mod);
    expect(html).toContain("—");
    expect(html).toContain("unknown");
  });

  it("renders the folder name", async () => {
    const { ModFolder } = await import("./mod-elements");
    const mod = makeMod("1", { folder: "@MyMod" });
    const html = renderWithMod(<ModFolder />, mod);
    expect(html).toContain("@MyMod");
  });
});

describe("ModDescription", () => {
  it("marks the empty state without a description", async () => {
    const { ModDescription } = await import("./mod-elements");
    const mod = makeMod("1", { description: "" });
    const html = renderWithMod(<ModDescription />, mod);
    expect(html).toContain("empty");
  });

  it("clamps to 6 lines by default via a style variable", async () => {
    const { ModDescription } = await import("./mod-elements");
    const mod = makeMod("1", { description: "Some text" });
    const html = renderWithMod(<ModDescription />, mod);
    expect(html).toContain("--t-line-clamp:6");
  });

  it("omits the clamp variable when clamp is none", async () => {
    const { ModDescription } = await import("./mod-elements");
    const mod = makeMod("1", { description: "Some text" });
    const html = renderWithMod(<ModDescription options={{ clamp: "none" }} />, mod);
    expect(html).not.toContain("--t-line-clamp");
  });
});

describe("ModUpdate", () => {
  it("renders nothing when the mod doesn't need an update", async () => {
    const { ModUpdate } = await import("./mod-elements");
    const mod = makeMod("1", { state: "ready" });
    expect(renderWithMod(<ModUpdate />, mod)).toBe("");
  });

  it("renders and calls store.updateMods with the mod id when clicked", async () => {
    const { ModUpdate } = await import("./mod-elements");
    const mod = makeMod("1", { state: "needs_update" });
    const updateMods = vi.fn();

    await withStore({ updateMods }, () => {
      resetCaptured();
      const html = renderWithMod(<ModUpdate />, mod);
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
    const mod = makeMod("1", { state: "needs_update" });
    await withStore({ op: { kind: "update", note: null } }, () => {
      const html = renderWithMod(<ModUpdate />, mod);
      expect(html).toContain("busy");
      expect(html).toContain("disabled");
    });
  });
});

describe("ModOpenInSteam", () => {
  it("calls openWorkshopInSteam with the workshop id and stops propagation", async () => {
    const mod = makeMod("42");
    await withStore({}, async () => {
      const { ModOpenInSteam } = await import("./mod-elements");
      resetCaptured();
      renderWithMod(<ModOpenInSteam />, mod);
      const onClick = captured["mod.openInSteam"].onClick as (e: { stopPropagation: () => void }) => void;
      const stopPropagation = vi.fn();
      onClick({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalled();
      expect(tauriMocks.openWorkshopInSteam).toHaveBeenCalledWith("42");
    });
  });
});

describe("ModOpenFolder", () => {
  it("is disabled without a folder and never calls openModFolder", async () => {
    const { ModOpenFolder } = await import("./mod-elements");
    const mod = makeMod("1", { folder: null });
    resetCaptured();
    const html = renderWithMod(<ModOpenFolder />, mod);
    expect(html).toContain("disabled");
    const onClick = captured["mod.openFolder"].onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });
    expect(tauriMocks.openModFolder).not.toHaveBeenCalled();
  });

  it("calls openModFolder with the mod's folder when present", async () => {
    const { ModOpenFolder } = await import("./mod-elements");
    const mod = makeMod("1", { folder: "@MyMod" });
    resetCaptured();
    const html = renderWithMod(<ModOpenFolder />, mod);
    expect(html).not.toContain("disabled");
    const onClick = captured["mod.openFolder"].onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });
    expect(tauriMocks.openModFolder).toHaveBeenCalledWith("@MyMod");
  });
});

describe("ModReinstall", () => {
  it("calls reinstallSubscribedMod with the workshop id and stops propagation", async () => {
    const { ModReinstall } = await import("./mod-elements");
    const mod = makeMod("7");
    resetCaptured();
    const html = renderWithMod(<ModReinstall />, mod);
    expect(html).not.toContain("busy");
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
    const mod = makeMod("1");
    await withStore({ selectedModId: "1" }, () => {
      resetCaptured();
      renderWithMod(<ModDeselect />, mod);
      const onClick = captured["mod.deselect"].onClick as (e: { stopPropagation: () => void }) => void;
      const stopPropagation = vi.fn();
      onClick({ stopPropagation });
      expect(stopPropagation).toHaveBeenCalled();
      expect(useModsStore.getState().selectedModId).toBeNull();
    });
  });
});

describe("ModNeededBy", () => {
  it("renders nothing when no server needs the mod", async () => {
    const { ModNeededBy } = await import("./mod-elements");
    const mod = makeMod("1");
    await withStore({ needing: [] }, () => {
      expect(renderWithMod(<ModNeededBy />, mod)).toBe("");
    });
  });

  it("shows the label and the count when servers need the mod", async () => {
    const { ModNeededBy } = await import("./mod-elements");
    const mod = makeMod("1");
    await withStore(
      {
        needing: [
          { addr: "1.2.3.4", query_port: 2305, name: "Server A", last_played: 100 },
          { addr: "5.6.7.8", query_port: 2305, name: "Server B", last_played: null },
        ],
      },
      () => {
        const html = renderWithMod(<ModNeededBy />, mod);
        expect(html).toContain("Needed by");
        expect(html).toContain(">2<");
      },
    );
  });
});

describe("ModServer displays", () => {
  function renderWithServer(node: React.ReactNode, srv: unknown): string {
    return renderToStaticMarkup(
      <ElementContextProvider value={{ subjectContext: { kind: "modServer", data: srv } }}>
        {node}
      </ElementContextProvider>,
    );
  }

  it("modServer.name falls back to addr:port without a name", async () => {
    const { ModServerName } = await import("./mod-elements");
    const html = renderWithServer(<ModServerName />, { addr: "1.2.3.4", query_port: 2305, name: "", last_played: null });
    expect(html).toContain("1.2.3.4:2305");
  });

  it("modServer.address always renders addr:port", async () => {
    const { ModServerAddress } = await import("./mod-elements");
    const html = renderWithServer(<ModServerAddress />, { addr: "1.2.3.4", query_port: 2305, name: "Server A", last_played: null });
    expect(html).toContain("1.2.3.4:2305");
  });

  it("modServer.lastPlayed shows 'never' and the never state without a timestamp", async () => {
    const { ModServerLastPlayed } = await import("./mod-elements");
    const html = renderWithServer(<ModServerLastPlayed />, { addr: "1.2.3.4", query_port: 2305, name: "Server A", last_played: null });
    expect(html).toContain("never");
    expect(html).toContain('data-state="never"');
  });

  it("modServer.lastPlayed formats a known timestamp relatively by default", async () => {
    const { ModServerLastPlayed } = await import("./mod-elements");
    const ts = Math.floor(Date.now() / 1000) - 120;
    const html = renderWithServer(<ModServerLastPlayed />, { addr: "1.2.3.4", query_port: 2305, name: "Server A", last_played: ts });
    expect(html).toContain("ago");
    expect(html).not.toContain('data-state="never"');
  });
});
