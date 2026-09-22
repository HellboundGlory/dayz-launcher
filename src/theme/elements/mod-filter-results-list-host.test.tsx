import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubscribedMod } from "@/lib/tauri";
import type { ModFilterEntry } from "@/stores/mod-filter-store";
import type { ListHostProps } from "../lists/list-host";

// SSR takes zustand's initial-state snapshot, so route the hooks through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

vi.mock("@/stores/mod-filter-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mod-filter-store")>();
  return { ...actual, useModFilterStore: liveHook(actual.useModFilterStore) };
});

// `list.modFilterResults` is virtualized, which needs a real scroll container to measure
// against — unavailable under `renderToStaticMarkup`. Stub `ListHost` so this file
// exercises only `ModFilterResultsListHost`'s own filtering/selection/state wiring.
let lastProps: ListHostProps<ModFilterEntry> | undefined;
vi.mock("../lists/list-host", () => ({
  ListHost: (props: ListHostProps<ModFilterEntry>) => {
    lastProps = props;
    return (
      <div data-testid="stub-list">
        {props.items.map((item) => (
          <span key={item.id}>{item.title}</span>
        ))}
      </div>
    );
  },
}));

const makeSubscribed = (id: string, overrides: Partial<SubscribedMod> = {}): SubscribedMod => ({
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

async function withStores<T>(
  modsOverrides: Record<string, unknown>,
  filterOverrides: Record<string, unknown>,
  fn: () => T,
): Promise<T> {
  const { useModsStore } = await import("@/stores/mods-store");
  const { useModFilterStore } = await import("@/stores/mod-filter-store");
  const priorMods = useModsStore.getState();
  const priorFilter = useModFilterStore.getState();
  useModsStore.setState({ ...priorMods, ...modsOverrides });
  useModFilterStore.setState({ ...priorFilter, ...filterOverrides });
  try {
    return fn();
  } finally {
    useModsStore.setState(priorMods, true);
    useModFilterStore.setState(priorFilter, true);
  }
}

describe("ModFilterResultsListHost", () => {
  it("lists subscribed DayZ mods on the subscribed tab", async () => {
    const { ModFilterResultsListHost } = await import("./list-elements");
    const html = await withStores(
      { rows: [makeSubscribed("1", { title: "Alpha" }), makeSubscribed("2", { title: "Bravo", for_dayz: false })] },
      { tab: "subscribed" },
      () => renderToStaticMarkup(<ModFilterResultsListHost />),
    );
    expect(html).toContain("Alpha");
    expect(html).not.toContain("Bravo");
  });

  it("filters the seen tab from `known`, and the workshop tab from `searchResults`", async () => {
    const { ModFilterResultsListHost } = await import("./list-elements");
    const htmlSeen = await withStores(
      {},
      {
        tab: "seen",
        known: [{ workshop_id: "9", name: "TraderPlus", server_count: 3 }],
      },
      () => renderToStaticMarkup(<ModFilterResultsListHost />),
    );
    expect(htmlSeen).toContain("TraderPlus");

    const htmlWorkshop = await withStores(
      {},
      {
        tab: "workshop",
        query: "expansion",
        searchResults: [
          {
            workshop_id: "5",
            title: "DayZ-Expansion",
            preview_url: null,
            description: null,
            tags: [],
            num_subscriptions: null,
            score: null,
            file_size: null,
            time_updated: null,
            workshop_url: null,
          },
        ],
      },
      () => renderToStaticMarkup(<ModFilterResultsListHost />),
    );
    expect(htmlWorkshop).toContain("DayZ-Expansion");
  });

  it("passes the previewed entry as selectedItem and marks row states", async () => {
    const { ModFilterResultsListHost } = await import("./list-elements");
    const alpha = makeSubscribed("1", { title: "Alpha" });
    await withStores(
      { rows: [alpha] },
      { tab: "subscribed", previewId: "1", selection: { "1": "include" } },
      () => renderToStaticMarkup(<ModFilterResultsListHost />),
    );
    expect(lastProps?.selectedItem?.id).toBe("1");
    const states = lastProps?.computeRowStates?.(lastProps.items[0], true) ?? [];
    expect(states).toEqual(expect.arrayContaining(["previewed", "included", "subscribed"]));
  });

  it("calls setPreviewId on select, and null on deselect", async () => {
    const { ModFilterResultsListHost } = await import("./list-elements");
    const { useModFilterStore } = await import("@/stores/mod-filter-store");
    const alpha = makeSubscribed("1", { title: "Alpha" });
    await withStores({ rows: [alpha] }, { tab: "subscribed" }, () => {
      renderToStaticMarkup(<ModFilterResultsListHost />);
      lastProps?.onSelect?.(lastProps.items[0]);
      expect(useModFilterStore.getState().previewId).toBe("1");
      lastProps?.onSelect?.(null);
      expect(useModFilterStore.getState().previewId).toBeNull();
    });
  });

  it("reports loading while the source's own loading flag is set, and searching for the workshop tab", async () => {
    const { ModFilterResultsListHost } = await import("./list-elements");
    let html = await withStores({ loading: true, rows: [] }, { tab: "subscribed" }, () =>
      renderToStaticMarkup(<ModFilterResultsListHost />),
    );
    expect(html).toContain('data-state="loading"');
    expect(lastProps?.emptyNode).toMatchObject({ value: "Loading…" });
    expect(lastProps?.items).toEqual([]);

    html = await withStores({}, { tab: "workshop", query: "x", searchLoading: true }, () =>
      renderToStaticMarkup(<ModFilterResultsListHost />),
    );
    expect(html).toContain('data-state="searching"');
  });

  it("shows the four empty/loading texts for their conditions", async () => {
    const { ModFilterResultsListHost } = await import("./list-elements");

    await withStores({ rows: [] }, { tab: "subscribed" }, () => renderToStaticMarkup(<ModFilterResultsListHost />));
    expect(lastProps?.emptyNode).toMatchObject({ value: "No subscribed DayZ mods." });

    await withStores({}, { tab: "workshop", query: "" }, () => renderToStaticMarkup(<ModFilterResultsListHost />));
    expect(lastProps?.emptyNode).toMatchObject({ value: "Type a mod name above to search the Workshop." });

    await withStores({}, { tab: "seen", known: [] }, () => renderToStaticMarkup(<ModFilterResultsListHost />));
    expect(lastProps?.emptyNode).toMatchObject({ value: "No mods match." });
  });
});
