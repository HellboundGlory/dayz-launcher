import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubscribedMod } from "@/lib/tauri";
import { SubjectContextProvider } from "./context";
import { renderModsElement } from "./mods-element-host";
import type { ElementNode } from "../renderer/types";

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
  it("delegates every element it owns to its own component", async () => {
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
      expect(renderModsElement({ element }, {}), element).not.toBeUndefined();
    }
  });

  it("returns undefined for anything it doesn't own", () => {
    expect(renderModsElement({ element: "server.name" }, {})).toBeUndefined();
  });
});

describe("mods.selectAll", () => {
  const inHeader = (node: ElementNode) =>
    renderToStaticMarkup(
      <SubjectContextProvider subject={null} contextName="listHeader">
        {renderModsElement(node, {})}
      </SubjectContextProvider>,
    );

  // A list header always renders the toggle: unchecked "Select all visible"
  // while anything is unchecked, checked "Deselect all" once everything is.
  it("renders the header toggle with its checked state, ignoring the element's options", async () => {
    const partial = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1"]) },
      () => inHeader({ element: "mods.selectAll" }),
    );
    expect(partial).toContain('aria-pressed="false"');
    expect(partial).toContain('aria-label="Select all visible"');
    expect(partial).not.toContain('data-state="checked"');

    const all = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1", "2"]) },
      () => inHeader({ element: "mods.selectAll" }),
    );
    expect(all).toContain('aria-pressed="true"');
    expect(all).toContain('data-state="checked"');
    expect(all).toContain('aria-label="Deselect all"');

    const withOptions = await withStore({ rows: [makeMod("1")], selectedIds: new Set() }, () =>
      inHeader({
        element: "mods.selectAll",
        options: { display: "iconLabel", icon: "check", label: "Everything" },
      }),
    );
    expect(withOptions).not.toContain('data-part="label"');
    expect(withOptions).not.toContain("lucide-square-check-big");
    expect(withOptions).not.toContain("Everything");
  });

  it("toggles the whole visible set from the header", async () => {
    const { useModsStore } = await import("@/stores/mods-store");

    await withStore({ rows: [makeMod("1"), makeMod("2")], selectedIds: new Set() }, () => {
      captured = {};
      inHeader({ element: "mods.selectAll" });
      onClickOf("mods.selectAll")();
      expect(useModsStore.getState().selectedIds).toEqual(new Set(["1", "2"]));

      captured = {};
      inHeader({ element: "mods.selectAll" });
      onClickOf("mods.selectAll")();
      expect(useModsStore.getState().selectedIds.size).toBe(0);
    });
  });

  it("ignores removed rows when deciding whether every visible mod is checked", async () => {
    const html = await withStore(
      {
        rows: [makeMod("1"), makeMod("2", { removed: true })],
        selectedIds: new Set(["1"]),
      },
      () => inHeader({ element: "mods.selectAll" }),
    );
    expect(html).toContain('aria-pressed="true"');
  });

  // Anywhere else it is the one-way action: "Select all", gone when it would
  // not change the checked set.
  it("renders Select all from a toolbar and hides once everything is checked", async () => {
    const node = { element: "mods.selectAll" };

    const partial = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1"]) },
      () => renderToStaticMarkup(<>{renderModsElement(node, {})}</>),
    );
    expect(partial).toContain(">Select all<");

    const all = await withStore(
      { rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1", "2"]) },
      () => renderToStaticMarkup(<>{renderModsElement(node, {})}</>),
    );
    expect(all).toBe("");

    const none = await withStore({ rows: [], selectedIds: new Set() }, () =>
      renderToStaticMarkup(<>{renderModsElement(node, {})}</>),
    );
    expect(none).toBe("");
  });

  it("selects every visible mod from the toolbar on click", async () => {
    const { useModsStore } = await import("@/stores/mods-store");

    await withStore({ rows: [makeMod("1"), makeMod("2")], selectedIds: new Set() }, () => {
      captured = {};
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll" }, {})}</>);
      onClickOf("mods.selectAll")();
      expect(useModsStore.getState().selectedIds).toEqual(new Set(["1", "2"]));
    });
  });

  it("honours the toolbar's icon/display/label options", async () => {
    const labelled = await withStore(
      { rows: [makeMod("1")], selectedIds: new Set() },
      () =>
        renderToStaticMarkup(
          <>{renderModsElement({ element: "mods.selectAll", options: { display: "iconLabel", icon: "check", label: "Select all" } }, {})}</>,
        ),
    );
    expect(labelled).toContain("lucide-check");
    expect(labelled).not.toContain("lucide-square-check-big");
    expect(labelled).toContain('data-part="label"');
    expect(labelled).toContain(">Select all<");

    const iconOnly = await withStore({ rows: [makeMod("1")], selectedIds: new Set() }, () =>
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectAll", options: { display: "icon" } }, {})}</>),
    );
    expect(iconOnly).not.toContain('data-part="label"');
    expect(iconOnly).toContain('aria-label="Select all"');
  });
});

describe("mods.unsubscribe", () => {
  it("labels from the selection or the running op, and disables when nothing is selected or an op is running", async () => {
    const render = (overrides: Record<string, unknown>) =>
      withStore(overrides, () =>
        renderToStaticMarkup(<>{renderModsElement({ element: "mods.unsubscribe" }, {})}</>),
      );

    const none = await render({ rows: [], selectedIds: new Set(), op: null });
    expect(none).toContain("Unsubscribe</span>");
    expect(none).toContain("disabled=\"\"");
    expect(none).toContain('data-state="disabled"');

    expect(await render({ rows: [makeMod("1"), makeMod("2")], selectedIds: new Set(["1", "2"]), op: null })).toContain(
      "Unsubscribe 2</span>",
    );
    expect(
      await render({
        rows: [makeMod("1")],
        selectedIds: new Set(["1"]),
        op: { kind: "unsubscribe", note: "REMOVING 1…" },
      }),
    ).toContain("REMOVING 1…</span>");
    expect(
      await render({
        rows: [makeMod("1")],
        selectedIds: new Set(["1"]),
        op: { kind: "verify", note: "CHECKING 1…" },
      }),
    ).toContain("disabled=\"\"");
  });

  it("unsubscribes the selection only once the confirmation is answered yes", async () => {
    const { useConfirmStore } = await import("@/stores/confirm-store");
    const unsubscribeSelected = vi.fn();

    await withStore({ rows: [makeMod("1")], selectedIds: new Set(["1"]), op: null, unsubscribeSelected }, () => {
      captured = {};
      renderToStaticMarkup(<>{renderModsElement({ element: "mods.unsubscribe" }, {})}</>);
      onClickOf("mods.unsubscribe")();

      expect(unsubscribeSelected).not.toHaveBeenCalled();
      expect(useConfirmStore.getState().request?.title).toBe("Unsubscribe from 1 mod");

      useConfirmStore.getState().resolve(false);
      expect(unsubscribeSelected).not.toHaveBeenCalled();

      onClickOf("mods.unsubscribe")();
      useConfirmStore.getState().resolve(true);
      expect(unsubscribeSelected).toHaveBeenCalledTimes(1);
    });
  });
});

describe("mods.unsubscribeMenu", () => {
  it("opens on click, exposing the selected/all items, and closes items call the right actions", async () => {
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
  it("verifies every mod even when some are selected, and shows the op note while running", async () => {
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
        expect(verifyAll).toHaveBeenCalledTimes(1);
        expect(verifySelected).not.toHaveBeenCalled();
      },
    );

    const html = await withStore(
      { rows: [makeMod("1")], op: { kind: "verify", note: "CHECKING 1…" } },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.verify" }, {})}</>),
    );
    expect(html).toContain("CHECKING 1…</span>");
    expect(html).toContain('data-state="busy"');
  });
});

describe("mods.verifyMenu items", () => {
  it("label with their counts and call the right store action, disabling selected with nothing selected", async () => {
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

    const disabled = await withStore(
      { rows: [makeMod("1")], selectedIds: new Set() },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.verifySelected" }, {})}</>),
    );
    expect(disabled).toContain("disabled=\"\"");
    expect(disabled).toContain("Verify selected</span>");
  });
});

describe("mods.updateOutdated", () => {
  it("renders nothing when nothing is outdated, else Update {n} and calls updateAllOutdated on click", async () => {
    const zeroHtml = await withStore(
      { rows: [makeMod("1", { state: "ready" })], op: null },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.updateOutdated" }, {})}</>),
    );
    expect(zeroHtml).toBe("");

    const updateAllOutdated = vi.fn();
    await withStore(
      {
        rows: [
          makeMod("1", { state: "needs_update" }),
          makeMod("2", { state: "needs_update" }),
          makeMod("3", { state: "needs_update" }),
        ],
        op: null,
        updateAllOutdated,
      },
      () => {
        captured = {};
        const html = renderToStaticMarkup(<>{renderModsElement({ element: "mods.updateOutdated" }, {})}</>);
        expect(html).toContain("Update 3</span>");
        expect(html).not.toContain("disabled=\"\"");

        onClickOf("mods.updateOutdated")();
        expect(updateAllOutdated).toHaveBeenCalledTimes(1);
      },
    );
  });
});

describe("mods.selectUnique", () => {
  it("shows the empty text and the disabled state with no cared servers, else 'Unique: <source>'", async () => {
    const empty = await withStore(
      { caredServers: [] },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectUnique" }, {})}</>),
    );
    expect(empty).toContain('data-el="mods.selectUnique"');
    expect(empty).toContain("Select unique…");
    expect(empty).toContain("disabled=\"\"");
    expect(empty).toContain('data-state="disabled"');

    const active = await withStore(
      { caredServers: [{ addr: "1.2.3.4", query_port: 2305, name: "Home" }], uniqueSource: "Home" },
      () => renderToStaticMarkup(<>{renderModsElement({ element: "mods.selectUnique" }, {})}</>),
    );
    expect(active).toContain("Unique: Home");
  });

  it("puts each menu's trigger inside its element root so themes can reach the popup", () => {
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
