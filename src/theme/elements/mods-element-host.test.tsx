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

// Captures onClick since renderToStaticMarkup drops event handlers from its HTML output.
let captured: Record<string, unknown> | undefined;
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      if (type === "button" && props && props["data-el"] === "mods.selectAll") {
        captured = props;
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

describe("renderModsElement", () => {
  it("delegates mod.name/mod.size/list.mods/mods.selectAll to their own components", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const known = ["mod.name", "mod.size", "list.mods", "mods.selectAll"];
    for (const element of known) {
      expect(renderModsElement({ element }, {})).not.toBeUndefined();
    }
  });

  it("returns undefined for anything it doesn't own", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    expect(renderModsElement({ element: "server.name" }, {})).toBeUndefined();
  });
});

describe("mods.selectAll", () => {
  it("renders unchecked when no visible mod is selected", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set() },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>),
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Select all visible"');
    expect(html).not.toContain('data-state="checked"');
  });

  it("renders checked once every visible mod is selected", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1", "2"]) },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-state="checked"');
    expect(html).toContain('aria-label="Deselect all"');
  });

  it("ignores removed rows when deciding whether every visible mod is checked", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      {
        rows: [makeMod("1"), makeMod("2", { removed: true })],
        selectedIds: new Set(["1"]),
      },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>),
    );
    expect(html).toContain('aria-pressed="true"');
  });

  it("click checks every visible mod when not all are checked, clears them otherwise", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const { useModsStore } = await import("@/stores/mods-store");

    await withStore({ rows: [makeMod("1"), makeMod("2")], selectedIds: new Set() }, () => {
      captured = undefined;
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>);
      let onClick = (captured as Record<string, unknown> | undefined)?.onClick as () => void;
      onClick();
      expect(useModsStore.getState().selectedIds).toEqual(new Set(["1", "2"]));

      captured = undefined;
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>);
      onClick = (captured as Record<string, unknown> | undefined)?.onClick as () => void;
      onClick();
      expect(useModsStore.getState().selectedIds.size).toBe(0);
    });
  });
});
