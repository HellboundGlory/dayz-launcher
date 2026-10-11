import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServerNeeding } from "@/lib/tauri";

// SSR takes zustand's initial-state snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/mods-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/mods-store")>();
  return { ...actual, useModsStore: liveHook(actual.useModsStore) };
});

const makeNeeding = (n: number, overrides: Partial<ServerNeeding> = {}): ServerNeeding => ({
  addr: `10.0.0.${n}`,
  query_port: 2305,
  name: `Server ${n}`,
  last_played: overrides.last_played === undefined ? 1000 : overrides.last_played,
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

describe("ModServersListHost", () => {
  it("marks the empty state and renders no rows without any needing servers", async () => {
    const { ModServersListHost } = await import("./list-elements");
    const html = await withStore({ needing: [] }, () => renderToStaticMarkup(<ModServersListHost />));
    expect(html).toContain('data-state="empty"');
    expect(html).not.toContain('data-part="more"');
  });

  it("renders every server up to 8, with a trailing '+N more' part beyond that", async () => {
    const { ModServersListHost } = await import("./list-elements");
    const eight = Array.from({ length: 8 }, (_, i) => makeNeeding(i + 1));
    const html = await withStore({ needing: eight }, () => renderToStaticMarkup(<ModServersListHost />));
    expect(html).toContain("Server 1");
    expect(html).toContain("Server 8");
    expect(html).not.toContain('data-part="more"');

    const eleven = Array.from({ length: 11 }, (_, i) => makeNeeding(i + 1));
    const capped = await withStore({ needing: eleven }, () => renderToStaticMarkup(<ModServersListHost />));
    expect(capped).toContain("Server 1");
    expect(capped).toContain("Server 8");
    expect(capped).not.toContain("Server 9");
    expect(capped).toContain('data-part="more"');
    expect(capped).toContain("+3 more");
  });

  it("marks a row 'played' only when it has a last-played timestamp", async () => {
    const { ModServersListHost } = await import("./list-elements");
    const needing = [makeNeeding(1, { last_played: 500 }), makeNeeding(2, { last_played: null })];
    const html = await withStore({ needing }, () => renderToStaticMarkup(<ModServersListHost />));
    const rows = html.split('data-row=""').slice(1);
    expect(rows[0]).toContain("played");
    expect(rows[1]).not.toContain('data-state="played"');
  });
});
