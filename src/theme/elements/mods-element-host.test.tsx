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

vi.mock("@/stores/confirm-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/confirm-store")>();
  return { ...actual, useConfirmStore: liveHook(actual.useConfirmStore) };
});

// Captures onClick per data-el since renderToStaticMarkup drops event handlers
// from its HTML output; keyed so several buttons rendered in one pass (e.g. a
// popup's items) can each be recovered.
let captured: Record<string, Record<string, unknown>> = {};
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>();
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      // `data-el` for a registered element; a plain option row (e.g. the
      // select-unique server list) has no `data-el`, so fall back to its title.
      const key = props && ((props["data-el"] as string | undefined) ?? (props["title"] as string | undefined));
      if (type === "button" && key) {
        captured[key] = props;
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

function onClickOf(el: string): () => void {
  return (captured[el] as Record<string, unknown> | undefined)?.onClick as () => void;
}

describe("renderModsElement", () => {
  it("delegates every mods.* action-bar element to its own component", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const known = [
      "mod.name",
      "mod.size",
      "list.mods",
      "mods.selectAll",
      "mods.search",
      "mods.statusFilter",
      "mods.refresh",
      "mods.count",
      "mods.clearSelection",
      "mods.cleanupRemoved",
      "mods.unsubscribe",
      "mods.unsubscribeMenu",
      "mods.unsubscribeSelected",
      "mods.unsubscribeAll",
      "mods.verify",
      "mods.verifyMenu",
      "mods.verifySelected",
      "mods.verifyAll",
      "mods.updateOutdated",
      "mods.selectUnique",
    ];
    for (const element of known) {
      expect(renderModsElement({ element }, {})).not.toBeUndefined();
    }
  });

  it("delegates the details-pane actions, neededBy and modServer/list.modServers ids", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const known = [
      "mod.update",
      "mod.openInSteam",
      "mod.openFolder",
      "mod.reinstall",
      "mod.deselect",
      "mod.neededBy",
      "modServer.name",
      "modServer.address",
      "modServer.lastPlayed",
      "list.modServers",
    ];
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
      captured = {};
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>);
      onClickOf("mods.selectAll")();
      expect(useModsStore.getState().selectedIds).toEqual(new Set(["1", "2"]));

      captured = {};
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>);
      onClickOf("mods.selectAll")();
      expect(useModsStore.getState().selectedIds.size).toBe(0);
    });
  });
});

describe("mods.unsubscribe", () => {
  it("labels by selection count and shows the op note while running", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const render = (overrides: Record<string, unknown>) =>
      withStore(overrides, () =>
        renderToStaticMarkup(<>{renderModsElement({ element: "mods.unsubscribe" }, {})}</>),
      );

    expect(await render({ rows: [], selectedIds: new Set(), op: null })).toContain("Unsubscribe</span>");
    expect(
      await render({ rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1", "2"]), op: null }),
    ).toContain("Unsubscribe 2</span>");
    expect(
      await render({
        rows: [makeMod("1")],
        selectedIds: new Set(["1"]),
        op: { kind: "unsubscribe", note: "REMOVING 1…" },
      }),
    ).toContain("REMOVING 1…</span>");
  });

  it("disables when nothing is selected or an op is running", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      { rows: [], selectedIds: new Set(), op: null },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.unsubscribe" }, {})}</>),
    );
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain('data-state="disabled"');

    const busyHtml = await withStore(
      {
        rows: [makeMod("1")],
        selectedIds: new Set(["1"]),
        op: { kind: "verify", note: "CHECKING 1…" },
      },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.unsubscribe" }, {})}</>),
    );
    expect(busyHtml).toContain("disabled=\"\"");
  });

  it("asks for confirmation and only unsubscribes once confirmed", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const unsubscribeSelected = vi.fn();

    await withStore({ rows: [makeMod("1")], selectedIds: new Set(["1"]), op: null, unsubscribeSelected }, () => {
      captured = {};
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.unsubscribe" }, {})}</>);
      onClickOf("mods.unsubscribe")();

      expect(unsubscribeSelected).not.toHaveBeenCalled();
      expect(useConfirmStore.getState().request?.title).toBe("Unsubscribe from 1 mod");

      useConfirmStore.getState().resolve(true);
      expect(unsubscribeSelected).toHaveBeenCalledTimes(1);
    });
  });

  it("does not unsubscribe when the confirmation is cancelled", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const unsubscribeSelected = vi.fn();

    await withStore({ rows: [makeMod("1")], selectedIds: new Set(["1"]), op: null, unsubscribeSelected }, () => {
      captured = {};
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.unsubscribe" }, {})}</>);
      onClickOf("mods.unsubscribe")();
      useConfirmStore.getState().resolve(false);
      expect(unsubscribeSelected).not.toHaveBeenCalled();
    });
  });
});

describe("mods.unsubscribeMenu", () => {
  it("opens on click, exposing the selected/all items, and closes items call the right actions", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const unsubscribeAll = vi.fn();

    await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(), op: null, unsubscribeAll },
      () => {
        captured = {};
        const closedHtml = renderToStaticMarkup(
          <>{renderModsElement({ element: "mods.unsubscribeMenu" }, {})}</>,
        );
        expect(closedHtml).not.toContain("mods.unsubscribeSelected");
        expect(closedHtml).toContain('aria-expanded="false"');

        // `mods.unsubscribeMenu` owns its own `open` boolean, which SSR can't
        // click through — render the popup's items directly, the way the
        // trigger does once open, to exercise them.
        const html = renderToStaticMarkup(<>{openUnsubscribeMenu(renderModsElement)}</>);
        expect(html).toContain('data-el="mods.unsubscribeSelected"');
        expect(html).toContain('data-el="mods.unsubscribeAll"');
        expect(html).toContain("Unsubscribe from all 2 (destructive)");

        captured = {};
        renderToStaticMarkup(<>{openUnsubscribeMenu(renderModsElement)}</>);
        onClickOf("mods.unsubscribeAll")();
        expect(unsubscribeAll).not.toHaveBeenCalled();
        useConfirmStore.getState().resolve(true);
        expect(unsubscribeAll).toHaveBeenCalledTimes(1);
      },
    );
  });
});

function openUnsubscribeMenu(
  renderModsElement: (node: { element: string }, ctx: object) => unknown,
) {
  // `mods.unsubscribeMenu` owns its own `open` boolean; render its popup
  // items directly the way the trigger does once open, since SSR can't
  // click through local component state.
  return (
    <>
      {renderModsElement({ element: "mods.unsubscribeSelected" }, {})}
      {renderModsElement({ element: "mods.unsubscribeAll" }, {})}
    </>
  );
}

describe("mods.verify", () => {
  it("verifies the selection when something is selected, else verifies all", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const verifySelected = vi.fn();
    const verifyAll = vi.fn();

    await withStore(
      {
        rows: [makeMod("1"), makeMod("2")],
        selectedIds: new Set(["1"]),
        op: null,
        verifySelected,
        verifyAll,
      },
      () => {
        captured = {};
        renderToStaticMarkup(<>{renderModsElement({ element: "mods.verify" }, {})}</>);
        onClickOf("mods.verify")();
        expect(verifySelected).toHaveBeenCalledTimes(1);
        expect(verifyAll).not.toHaveBeenCalled();
      },
    );

    await withStore(
      { rows: [makeMod("1")], selectedIds: new Set(), op: null, verifySelected, verifyAll },
      () => {
        captured = {};
        renderToStaticMarkup(<>{renderModsElement({ element: "mods.verify" }, {})}</>);
        onClickOf("mods.verify")();
        expect(verifyAll).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("shows the op note while a verify is running", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      { rows: [makeMod("1")], op: { kind: "verify", note: "CHECKING 1…" } },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.verify" }, {})}</>),
    );
    expect(html).toContain("CHECKING 1…</span>");
    expect(html).toContain('data-state="busy"');
  });
});

describe("mods.verifyMenu items", () => {
  it("verify selected/all items label with counts and call the right store actions", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const verifySelected = vi.fn();
    const verifyAll = vi.fn();

    await withStore(
      {
        rows: [makeMod("1"), makeMod("2")],
        selectedIds: new Set(["1"]),
        verifySelected,
        verifyAll,
      },
      () => {
        captured = {};
        const html = renderToStaticMarkup(
          <>
            {renderModsElement({ element: "mods.verifySelected" }, {})}
            {renderModsElement({ element: "mods.verifyAll" }, {})}
          </>,
        );
        expect(html).toContain("Verify selected (1)");
        expect(html).toContain("Verify all (2)");

        onClickOf("mods.verifySelected")();
        expect(verifySelected).toHaveBeenCalledTimes(1);

        onClickOf("mods.verifyAll")();
        expect(verifyAll).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("disables verify selected when nothing is selected", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      { rows: [makeMod("1")], selectedIds: new Set() },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.verifySelected" }, {})}</>),
    );
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Verify selected</span>");
  });
});

describe("mods.updateOutdated", () => {
  it("labels with the outdated count and disables at zero", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const zeroHtml = await withStore(
      { rows: [makeMod("1", { state: "ready" })], op: null },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.updateOutdated" }, {})}</>),
    );
    expect(zeroHtml).toContain("disabled=\"\"");
    expect(zeroHtml).toContain('data-state="disabled"');

    const html = await withStore(
      {
        rows: [makeMod("1", { state: "needs_update" }), makeMod("2", { state: "needs_update" })],
        op: null,
      },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.updateOutdated" }, {})}</>),
    );
    expect(html).toContain("Update 2 outdated</span>");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("calls updateAllOutdated on click", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const updateAllOutdated = vi.fn();
    await withStore(
      { rows: [makeMod("1", { state: "needs_update" })], op: null, updateAllOutdated },
      () => {
        captured = {};
        renderToStaticMarkup(<>{renderModsElement({ element: "mods.updateOutdated" }, {})}</>);
        onClickOf("mods.updateOutdated")();
        expect(updateAllOutdated).toHaveBeenCalledTimes(1);
      },
    );
  });
});

describe("mods.selectUnique", () => {
  it("shows the empty text when there are no cared servers", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      { caredServers: [] },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectUnique" }, {})}</>),
    );
    expect(html).toContain("Select unique…");
    expect(html).toContain("disabled=\"\"");
  });

  it("shows 'Unique: <source>' once a unique-to-a-server selection is active", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    const html = await withStore(
      { caredServers: [{ addr: "1.2.3.4", query_port: 2305, name: "Home" }], uniqueSource: "Home" },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectUnique" }, {})}</>),
    );
    expect(html).toContain("Unique: Home");
  });

  it("puts each menu's trigger inside its element root so themes can reach the popup", async () => {
    const { renderModsElement } = await import("./mods-element-host");
    for (const element of ["mods.unsubscribeMenu", "mods.verifyMenu", "mods.selectUnique"]) {
      const html = renderToStaticMarkup(<>{renderModsElement({ element }, {})}</>);
      expect(html).toMatch(new RegExp(`^<div[^>]*data-el="${element.replace(".", "\\.")}"[^>]*><button[^>]*data-part="trigger"`));
    }
  });
});

describe("ModsSelectUniquePopup", () => {
  it("renders nothing while closed", async () => {
    const { ModsSelectUniquePopup } = await import("./mods-toolbar-elements");
    const html = renderToStaticMarkup(
      <>{ModsSelectUniquePopup({ open: false, caredServers: [], onSelect: vi.fn() })}</>,
    );
    expect(html).toBe("");
  });

  it("shows the empty text when there are no cared servers", async () => {
    const { ModsSelectUniquePopup } = await import("./mods-toolbar-elements");
    const html = renderToStaticMarkup(
      <>{ModsSelectUniquePopup({ open: true, caredServers: [], onSelect: vi.fn() })}</>,
    );
    expect(html).toContain("No favourites or recently played servers yet.");
  });

  it("lists cared servers and calls onSelect with addr/port/name on click", async () => {
    const { ModsSelectUniquePopup } = await import("./mods-toolbar-elements");
    const onSelect = vi.fn();
    const caredServers = [{ addr: "1.2.3.4", query_port: 2305, name: "Home Server" }];

    captured = {};
    const html = renderToStaticMarkup(
      <>{ModsSelectUniquePopup({ open: true, caredServers, onSelect })}</>,
    );
    expect(html).toContain("Home Server");

    onClickOf("Home Server")();
    expect(onSelect).toHaveBeenCalledWith("1.2.3.4", 2305, "Home Server");
  });
});
