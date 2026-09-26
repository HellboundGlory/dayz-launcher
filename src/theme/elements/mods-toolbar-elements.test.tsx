import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubscribedMod } from "@/lib/tauri";

function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

// Captures props by data-el since renderToStaticMarkup drops event handlers.
const captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      const el = props?.["data-el"];
      if (typeof el === "string") captured[el] = props;
      return actual.jsxDEV(type, props, ...rest);
    },
  };
});

const askConfirmCalls: { title: string; message: string; action: () => void }[] = [];
vi.mock("@/components/confirm-dialog", () => ({
  useConfirm: () => (title: string, message: string, action: () => void) => {
    askConfirmCalls.push({ title, message, action });
  },
}));

vi.mock("../theme-store", () => ({
  useLayoutSubscription: () => {},
  getThemeOwnedLayout: () => undefined,
}));

const makeMod = (id: string, overrides: Partial<SubscribedMod> = {}): SubscribedMod => ({
  workshop_id: id,
  title: `Mod ${id}`,
  state: "ready",
  size_on_disk: "100",
  time_updated: 100,
  time_added_to_user_list: 100,
  install_timestamp: 100,
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
  time_created: 100,
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

describe("ModsStatusFilter", () => {
  it("marks the active filter option as selected", async () => {
    const { ModsStatusFilter } = await import("./mods-toolbar-elements");
    const html = await withStore({ statusFilter: "outdated" }, () =>
      renderToStaticMarkup(<ModsStatusFilter />),
    );
    expect(html).toContain('data-part="option"');
    expect(html).toContain('data-state="selected"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Outdated");
  });
});

describe("ModsCount", () => {
  it("shows the total when nothing is selected", async () => {
    const { ModsCount } = await import("./mods-toolbar-elements");
    const html = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set() },
      () => renderToStaticMarkup(<ModsCount />),
    );
    expect(html).not.toContain('data-state="selecting"');
    expect(html).toContain("2");
    expect(html).toContain("mods");
  });

  it("shows N of M selected once something is checked", async () => {
    const { ModsCount } = await import("./mods-toolbar-elements");
    const html = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1"]) },
      () => renderToStaticMarkup(<ModsCount />),
    );
    expect(html).toContain('data-state="selecting"');
    expect(html).toContain("of 2 selected");
  });
});

describe("ModsClearSelection", () => {
  it("is disabled when nothing is selected", async () => {
    const { ModsClearSelection } = await import("./mods-toolbar-elements");
    const html = await withStore({ selectedIds: new Set() }, () =>
      renderToStaticMarkup(<ModsClearSelection />),
    );
    expect(html).toContain(" disabled=");
  });

  it("is enabled once something is selected", async () => {
    const { ModsClearSelection } = await import("./mods-toolbar-elements");
    const html = await withStore({ selectedIds: new Set(["1"]) }, () =>
      renderToStaticMarkup(<ModsClearSelection />),
    );
    expect(html).not.toContain(" disabled=");
  });

  it("shows no icon by default, matching today's markup", async () => {
    const { ModsClearSelection } = await import("./mods-toolbar-elements");
    const html = await withStore({ selectedIds: new Set() }, () =>
      renderToStaticMarkup(<ModsClearSelection />),
    );
    expect(html).not.toContain('data-part="icon"');
    expect(html).toContain(">Clear<");
  });

  it("honours the icon and label options", async () => {
    const { ModsClearSelection } = await import("./mods-toolbar-elements");
    const html = await withStore({ selectedIds: new Set() }, () =>
      renderToStaticMarkup(<ModsClearSelection options={{ display: "iconLabel", icon: "check", label: "Reset" }} />),
    );
    expect(html).toContain('data-part="icon"');
    expect(html).toContain("lucide-check");
    expect(html).toContain(">Reset<");
  });
});

describe("ModsCleanupRemoved", () => {
  it("renders nothing when there are no removed rows", async () => {
    const { ModsCleanupRemoved } = await import("./mods-toolbar-elements");
    const html = await withStore({ rows: [makeMod("1")] }, () =>
      renderToStaticMarkup(<ModsCleanupRemoved />),
    );
    expect(html).toBe("");
  });

  it("renders and asks for confirmation before cleaning up", async () => {
    const { ModsCleanupRemoved } = await import("./mods-toolbar-elements");
    askConfirmCalls.length = 0;
    delete captured["mods.cleanupRemoved"];
    const html = await withStore(
      { rows: [makeMod("1"), makeMod("2", { removed: true })] },
      () => renderToStaticMarkup(<ModsCleanupRemoved />),
    );
    expect(html).toContain("Clean up 1");
    const onClick = captured["mods.cleanupRemoved"]?.onClick as () => void;
    onClick();
    expect(askConfirmCalls).toHaveLength(1);
    expect(askConfirmCalls[0].title).toBe("Clean up removed mods");
  });

  it("honours the icon option and display: icon", async () => {
    const { ModsCleanupRemoved } = await import("./mods-toolbar-elements");
    const withDefault = await withStore(
      { rows: [makeMod("1", { removed: true })] },
      () => renderToStaticMarkup(<ModsCleanupRemoved />),
    );
    expect(withDefault).toContain("lucide-trash2");

    const iconOnly = await withStore(
      { rows: [makeMod("1", { removed: true })] },
      () => renderToStaticMarkup(<ModsCleanupRemoved options={{ display: "icon", icon: "check" }} />),
    );
    expect(iconOnly).not.toContain('data-part="label"');
    expect(iconOnly).toContain("lucide-check");
  });
});

describe("ModsRefresh", () => {
  it("renders icon and label by default, matching today's markup", async () => {
    const { ModsRefresh } = await import("./mods-toolbar-elements");
    const html = await withStore({}, () => renderToStaticMarkup(<ModsRefresh />));
    expect(html).toContain("lucide-refresh-cw");
    expect(html).toContain(">Refresh<");
  });

  it("honours the icon, display and label options", async () => {
    const { ModsRefresh } = await import("./mods-toolbar-elements");
    const iconOnly = await withStore({}, () =>
      renderToStaticMarkup(<ModsRefresh options={{ display: "icon", icon: "check" }} />),
    );
    expect(iconOnly).not.toContain('data-part="label"');
    expect(iconOnly).toContain("lucide-check");

    const labelled = await withStore({}, () =>
      renderToStaticMarkup(<ModsRefresh options={{ label: "Reload" }} />),
    );
    expect(labelled).toContain(">Reload<");
  });
});

describe("ModsSelectUnique", () => {
  it("is disabled with no cared servers", async () => {
    const { ModsSelectUnique } = await import("./mods-toolbar-elements");
    const html = await withStore({ caredServers: [] }, () => renderToStaticMarkup(<ModsSelectUnique />));
    expect(html).toContain('data-el="mods.selectUnique"');
    expect(html).toContain('data-state="disabled"');
  });

  it("shows the active unique source once selected", async () => {
    const { ModsSelectUnique } = await import("./mods-toolbar-elements");
    const html = await withStore(
      { caredServers: [{ addr: "1.2.3.4", query_port: 2303, name: "Some Server" }], uniqueSource: "Some Server" },
      () => renderToStaticMarkup(<ModsSelectUnique />),
    );
    expect(html).toContain("Unique: Some Server");
  });
});
