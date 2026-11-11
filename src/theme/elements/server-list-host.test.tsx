import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Server } from "@/types/server";
import type { ListHostProps } from "../lists/list-host";
import type { LayoutFile } from "../renderer/types";
import type * as ServerStoreModule from "@/stores/server-store";
import { useServerStore } from "@/stores/server-store";
import { ServerListHost } from "./list-elements";

// SSR reads zustand's initial snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof ServerStoreModule>();
  return { ...actual, useServerStore: liveHook(actual.useServerStore) };
});

// The list is virtualised, which needs a real scroll container to measure
// against — unavailable under `renderToStaticMarkup`. Stub it so this file
// exercises only what `ServerListHost` hands it.
let lastProps: ListHostProps<Server> | undefined;
let listLayout: LayoutFile | undefined;
vi.mock("../lists/list-host", () => ({
  ListHost: (props: ListHostProps<Server>) => {
    lastProps = props;
    return <div data-testid="stub-list" />;
  },
  ServerRowMenu: () => null,
}));

vi.mock("../theme-store", () => ({
  useLayoutSubscription: () => {},
  getActiveLayout: (path: string) => (path === "layout/lists/servers.json" ? listLayout : undefined),
}));

beforeEach(() => {
  lastProps = undefined;
  listLayout = undefined;
  useServerStore.setState({ servers: [] });
  useServerStore.getState().setFilter({ lan_addrs: null });
});

describe("ServerListHost", () => {
  it("hands the list the LAN empty state while the LAN tab shows nothing", () => {
    useServerStore.getState().setFilter({ lan_addrs: [] });
    renderToStaticMarkup(<ServerListHost />);

    expect(lastProps?.emptySlot).toBeTruthy();
  });

  it("keeps the list's own empty text on the LAN tab while a search is typed", () => {
    useServerStore.getState().setFilter({ lan_addrs: [], search: "1.2.3.4" });
    renderToStaticMarkup(<ServerListHost />);

    expect(lastProps?.emptySlot).toBeUndefined();
    useServerStore.getState().setFilter({ search: "" });
  });

  it("leaves the list's own empty text on every other tab", () => {
    renderToStaticMarkup(<ServerListHost />);

    expect(lastProps?.emptySlot).toBeUndefined();
    expect(lastProps?.emptyText).toBeTruthy();
  });

  it("hands the layout's empty node to a loaded list with no matches", () => {
    const emptyNode = { type: "text", value: "Nothing here" } as const;
    listLayout = { schemaVersion: 2, empty: emptyNode };
    useServerStore.setState({ hasLoadedOnce: true });

    renderToStaticMarkup(<ServerListHost />);

    expect(lastProps?.emptyNode).toEqual(emptyNode);
  });

  it("keeps the launcher text for no matches when the theme has no empty block", () => {
    useServerStore.setState({ hasLoadedOnce: true });

    renderToStaticMarkup(<ServerListHost />);

    expect(lastProps?.emptyNode).toBeUndefined();
    expect(lastProps?.emptyText).toBe("No servers match the current filters.");
  });

  it("keeps the launcher's empty text while the list is still loading", () => {
    const emptyNode = { type: "text", value: "Nothing here" } as const;
    listLayout = { schemaVersion: 2, empty: emptyNode };
    useServerStore.setState({ hasLoadedOnce: false });

    renderToStaticMarkup(<ServerListHost />);

    expect(lastProps?.emptyNode).toBeUndefined();
    expect(lastProps?.emptyText).toContain("No servers yet");
  });
});
