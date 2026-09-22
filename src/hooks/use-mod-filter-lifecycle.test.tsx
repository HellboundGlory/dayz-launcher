import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SubscribedMod } from "@/lib/tauri";
import { useModFilterLifecycle } from "./use-mod-filter-lifecycle";

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

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, getModUsage: vi.fn(() => Promise.resolve([])) };
});

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

// renderToStaticMarkup runs a component's render body (so `useMemo` executes) but
// never its effects — the hook's side effects (loading, usage merge) are exercised
// through the components that consume it (the legacy modal, the themed wrapper).
function Harness({ onResult }: { onResult: (rows: SubscribedMod[]) => void }) {
  const { subscribedRows } = useModFilterLifecycle();
  onResult(subscribedRows);
  return null;
}

describe("useModFilterLifecycle", () => {
  it("derives subscribedRows from the mods store via subscribedForDayz", async () => {
    const { useModsStore } = await import("@/stores/mods-store");
    const prior = useModsStore.getState();
    useModsStore.setState({
      ...prior,
      rows: [
        makeSubscribed("2", { title: "Zebra" }),
        makeSubscribed("1", { title: "Alpha" }),
        makeSubscribed("3", { title: "Not DayZ", for_dayz: false }),
      ],
    });
    try {
      let result: SubscribedMod[] = [];
      renderToStaticMarkup(<Harness onResult={(rows) => (result = rows)} />);
      expect(result.map((m) => m.title)).toEqual(["Alpha", "Zebra"]);
    } finally {
      useModsStore.setState(prior, true);
    }
  });
});
