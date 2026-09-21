import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubscribedMod } from "@/lib/tauri";
import type { ListHostProps } from "../lists/list-host";

// SSR takes zustand's initial-state snapshot, so route the hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

// `list.mods` is virtualized, which needs a real scroll container to measure
// against — unavailable under `renderToStaticMarkup`. Stub `ListHost` so this
// file exercises only `ModsListHost`'s own filtering/sorting/selection wiring.
let lastProps: ListHostProps<SubscribedMod> | undefined;
vi.mock("../lists/list-host", () => ({
  ListHost: (props: ListHostProps<SubscribedMod>) => {
    lastProps = props;
    return (
      <div data-testid="stub-list">
        {props.items.map((item) => (
          <span key={item.workshop_id}>{item.title}</span>
        ))}
      </div>
    );
  },
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

describe("ModsListHost", () => {
  it("filters by status through the store's own status-filter logic", async () => {
    const { ModsListHost } = await import("./list-elements");
    const html = await withStore(
      {
        rows: [
          makeMod("1", { title: "Alpha", state: "ready" }),
          makeMod("2", { title: "Bravo", state: "needs_update" }),
        ],
        statusFilter: "outdated",
      },
      () => renderToStaticMarkup(<ModsListHost />),
    );
    expect(html).toContain("Bravo");
    expect(html).not.toContain("Alpha");
  });

  it("filters by the search box across title, tags and workshop id", async () => {
    const { ModsListHost } = await import("./list-elements");
    const html = await withStore(
      {
        rows: [makeMod("1", { title: "Alpha" }), makeMod("2", { title: "Bravo" })],
        search: "alpha",
      },
      () => renderToStaticMarkup(<ModsListHost />),
    );
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Bravo");
  });

  it("sorts visible rows through the store's sort key/direction", async () => {
    const { ModsListHost } = await import("./list-elements");
    const html = await withStore(
      {
        rows: [makeMod("1", { title: "Zebra" }), makeMod("2", { title: "Alpha" })],
        sortKey: "name",
        sortDir: "asc",
      },
      () => renderToStaticMarkup(<ModsListHost />),
    );
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Zebra"));
  });

  it("passes the selected row, checked ids and status-state name through computeRowStates", async () => {
    const { ModsListHost } = await import("./list-elements");
    const alpha = makeMod("1", { title: "Alpha", state: "needs_update" });
    await withStore(
      {
        rows: [alpha],
        selectedModId: "1",
        selectedIds: new Set(["1"]),
      },
      () => renderToStaticMarkup(<ModsListHost />),
    );
    expect(lastProps?.selectedItem).toEqual(alpha);
    expect(lastProps?.computeRowStates?.(alpha, true)).toEqual(["selected", "checked", "update"]);
  });

  it("maps sort header clicks straight onto the store's setSort", async () => {
    const { ModsListHost } = await import("./list-elements");
    const { useModsStore } = await import("@/stores/mods-store");
    await withStore({ rows: [makeMod("1")], sortKey: "name", sortDir: "asc" }, () => {
      renderToStaticMarkup(<ModsListHost />);
      lastProps?.onSortChange?.("size");
      expect(useModsStore.getState().sortKey).toBe("size");
    });
  });

  it("toggles openMod on re-click of the already-open row, opens on click of another", async () => {
    const { ModsListHost } = await import("./list-elements");
    const { useModsStore } = await import("@/stores/mods-store");
    const alpha = makeMod("1", { title: "Alpha" });
    const bravo = makeMod("2", { title: "Bravo" });
    await withStore({ rows: [alpha, bravo], selectedModId: "1" }, () => {
      renderToStaticMarkup(<ModsListHost />);

      lastProps?.onSelect?.(alpha);
      expect(useModsStore.getState().selectedModId).toBeNull();

      useModsStore.setState({ selectedModId: "1" });
      lastProps?.onSelect?.(bravo);
      expect(useModsStore.getState().selectedModId).toBe("2");
    });
  });
});
