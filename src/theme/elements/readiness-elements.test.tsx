import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModReadinessEntry, ServerModReadiness, Server } from "@/types/server";
import { useServerStore } from "@/stores/server-store";
import { computeReadinessView, ServerDownloadSize, ServerReadiness } from "./readiness-elements";
import { useSelectionReadiness } from "./use-selection-readiness";
import { ElementContextProvider } from "./context";

// SSR takes zustand's initial-state snapshot, so route the hook through the live state.
function liveHook<T extends { getState: () => S }, S>(store: T) {
  return Object.assign(<R,>(sel: (s: S) => R) => sel(store.getState()), store);
}

vi.mock("@/stores/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/server-store")>();
  return { ...actual, useServerStore: liveHook(actual.useServerStore) };
});

vi.mock("./use-selection-readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-selection-readiness")>()),
  useSelectionReadiness: vi.fn(),
}));

const mod = (overrides: Partial<ModReadinessEntry>): ModReadinessEntry => ({
  workshop_id: "1",
  name: "Some Mod",
  state: "ready",
  size_bytes: null,
  size_is_upper_bound: false,
  preview_url: null,
  is_unique: false,
  downloaded_bytes: null,
  total_bytes: null,
  ...overrides,
});

const readiness = (mods: ModReadinessEntry[], stale = false): ServerModReadiness => ({ stale, mods });

function setReadiness(value: ServerModReadiness | null, loading: boolean) {
  vi.mocked(useSelectionReadiness).mockReturnValue({ readiness: value, loading });
}

describe("computeReadinessView", () => {
  it.each([
    {
      case: "reports checking while the fetch is in flight, regardless of any stale data",
      readiness: readiness([mod({ state: "ready" })], true),
      loading: true,
      expected: { dataState: "checking", label: "Checking mods…", sizeBytes: null, sizeIsUpperBound: false },
    },
    {
      case: "reports unchecked when no data has resolved",
      readiness: null,
      loading: false,
      expected: { dataState: "unchecked", label: "Mods not checked", sizeBytes: null, sizeIsUpperBound: false },
    },
    {
      case: "reports noMods for an empty declared list",
      readiness: readiness([]),
      loading: false,
      expected: { dataState: "noMods", label: "No mods declared", sizeBytes: null, sizeIsUpperBound: false },
    },
    {
      case: "reports ready when every mod is ready or not on the workshop",
      readiness: readiness([mod({ state: "ready" }), mod({ state: "not_on_workshop" })]),
      loading: false,
      expected: { dataState: "ready", label: "All mods ready", sizeBytes: null, sizeIsUpperBound: false },
    },
    {
      case: "counts mods needing download and sums their full size",
      readiness: readiness([
        mod({ state: "not_installed", size_bytes: 1000 }),
        mod({ state: "not_subscribed", size_bytes: 2000 }),
        mod({ state: "ready" }),
      ]),
      loading: false,
      expected: { dataState: "needsDownload", label: "2 to download", sizeBytes: 3000, sizeIsUpperBound: false },
    },
    {
      case: "counts mods needing an update and marks the size an upper bound",
      readiness: readiness([mod({ state: "needs_update", size_bytes: 5000, size_is_upper_bound: true })]),
      loading: false,
      expected: { dataState: "needsUpdate", label: "1 to update", sizeBytes: 5000, sizeIsUpperBound: true },
    },
    {
      case: "prefixes the mixed total 'up to' when any outstanding item is an update",
      readiness: readiness([
        mod({ state: "not_installed", size_bytes: 1000, size_is_upper_bound: false }),
        mod({ state: "needs_update", size_bytes: 4000, size_is_upper_bound: true }),
      ]),
      loading: false,
      expected: { dataState: "needsDownload", label: "1 to download", sizeBytes: 5000, sizeIsUpperBound: true },
    },
    {
      case: "reports live download progress and replaces the size estimate",
      readiness: readiness([
        mod({ state: "downloading", downloaded_bytes: 512, total_bytes: 2048 }),
        mod({ state: "not_installed", size_bytes: 1000 }),
      ]),
      loading: false,
      expected: { dataState: "downloading", label: "Downloading 512 bytes of 2 KB", sizeBytes: 3048, sizeIsUpperBound: false },
    },
    {
      case: "takes the first of downloading, needsDownload, needsUpdate, unchecked, noMods, ready",
      readiness: readiness([mod({ state: "needs_update" }), mod({ state: "not_installed" }), mod({ state: "downloading" })]),
      loading: false,
      expected: { dataState: "downloading", label: "Downloading 0 bytes of 0 bytes", sizeBytes: 0, sizeIsUpperBound: false },
    },
    {
      case: "carries stale through, overriding the content state on data-state",
      readiness: readiness([mod({ state: "needs_update", size_bytes: 10 })], true),
      loading: false,
      expected: { dataState: "stale", label: "1 to update", sizeBytes: 10, sizeIsUpperBound: false },
    },
  ])("$case", ({ readiness, loading, expected }) => {
    expect(computeReadinessView(readiness, loading)).toEqual(expected);
  });
});

describe("ServerReadiness", () => {
  it("renders dot, label and size parts by default", () => {
    setReadiness(readiness([mod({ state: "not_installed", size_bytes: 1024 })]), false);
    const html = renderToStaticMarkup(<ServerReadiness />);
    expect(html).toContain('data-el="server.readiness"');
    expect(html).toContain('data-state="needsDownload"');
    expect(html).toContain('data-part="dot"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain("1 to download");
    expect(html).toContain('data-part="size"');
    expect(html).toContain("1 KB");
  });

  it.each([
    { case: "dot", options: { showDot: false }, part: 'data-part="dot"' },
    { case: "size", options: { showSize: false }, part: 'data-part="size"' },
  ])("omits the $case part when its option is false", ({ options, part }) => {
    setReadiness(readiness([mod({ state: "not_installed", size_bytes: 1024 })]), false);
    expect(renderToStaticMarkup(<ServerReadiness options={options} />)).not.toContain(part);
  });

  it("prefixes the rendered size with 'up to' when an update is outstanding", () => {
    setReadiness(readiness([mod({ state: "needs_update", size_bytes: 1024, size_is_upper_bound: true })]), false);
    expect(renderToStaticMarkup(<ServerReadiness />)).toContain("up to 1 KB");
  });

  it("takes offline from its own subject, else the selection", () => {
    setReadiness(readiness([mod({ state: "not_installed", size_bytes: 1024 })]), false);
    expect(
      renderToStaticMarkup(
        <ElementContextProvider value={{ selectedServer: { online: false } as Server }}>
          <ServerReadiness />
        </ElementContextProvider>,
      ),
    ).toContain('data-state="needsDownload offline"');

    setReadiness(readiness([mod({ state: "ready" })]), false);
    expect(
      renderToStaticMarkup(
        <ElementContextProvider
          value={{
            subjectContext: { kind: "server", data: { online: false } as Server },
            selectedServer: { online: true } as Server,
          }}
        >
          <ServerReadiness />
        </ElementContextProvider>,
      ),
    ).toContain('data-state="ready offline"');
  });
});

describe("ServerReadiness declared basis", () => {
  const declaredServer = { addr: "192.168.1.1", online: true, modded: true, mod_count: 3 } as Server;

  it.each([
    { case: "pending update", pending: true, modded: true, modCount: 3, state: "needsUpdate", label: "Mod update pending — verify before join" },
    { case: "unchecked modded", pending: false, modded: true, modCount: null, state: "unchecked", label: "Mods not checked — verify before join" },
    { case: "declared none", pending: false, modded: true, modCount: 0, state: "noMods", label: "No mods declared" },
    { case: "unprobed non-modded", pending: false, modded: false, modCount: null, state: "noMods", label: "No mods declared" },
    { case: "declared count", pending: false, modded: true, modCount: 3, state: "ready", label: "3 mods declared" },
  ])("$case reads $label with state $state and no size", ({ pending, modded, modCount, state, label }) => {
    useServerStore.setState({ modPending: pending ? { [declaredServer.addr]: true } : {} });
    setReadiness(null, false);
    const html = renderToStaticMarkup(
      <ElementContextProvider
        value={{ subjectContext: { kind: "server", data: { ...declaredServer, modded, mod_count: modCount } as Server } }}
      >
        <ServerReadiness options={{ basis: "declared" }} />
      </ElementContextProvider>,
    );
    expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain(label);
    expect(html).toContain('data-part="dot"');
    expect(html).not.toContain('data-part="size"');
  });
});

describe("ServerDownloadSize", () => {
  const moddedServer = { addr: "192.168.1.1", online: true, modded: true, mod_count: 4 } as Server;

  function renderDownloadSize(value: ServerModReadiness | null): string {
    setReadiness(value, false);
    return renderToStaticMarkup(
      <ElementContextProvider value={{ subjectContext: { kind: "server", data: moddedServer } }}>
        <ServerDownloadSize />
      </ElementContextProvider>,
    );
  }

  it.each([
    {
      case: "an upper-bound estimate",
      mods: [
        mod({ state: "needs_update", size_bytes: 5000, size_is_upper_bound: true }),
        mod({ state: "ready" }),
        mod({ state: "ready" }),
        mod({ state: "ready" }),
      ],
      state: "upperBound",
      count: "4 mods",
      size: "up to 4.9 KB",
      qualifier: 'data-part="qualifier">up to </span>',
    },
    {
      case: "an exact size",
      mods: [mod({ state: "not_installed", size_bytes: 3000, size_is_upper_bound: false })],
      state: undefined,
      count: "1 mod",
      size: "2.9 KB",
      qualifier: undefined,
    },
    {
      case: "a zero download size when nothing is outstanding",
      mods: [mod({ state: "ready" })],
      state: "none",
      count: "1 mod",
      size: "0 bytes",
      qualifier: undefined,
    },
  ])("renders the count and $case", ({ mods, state, count, size, qualifier }) => {
    const html = renderDownloadSize(readiness(mods));
    expect(html).toContain(`data-part="count">${count}<`);
    expect(html.replace(/<[^>]+>/g, "")).toContain(`Download size: ${size}`);
    if (qualifier) expect(html).toContain(qualifier);
    else expect(html).not.toContain('data-part="qualifier"');
    if (state) expect(html).toContain(`data-state="${state}"`);
    else expect(html).not.toContain("data-state=");
  });

  it("adds offline to data-state while the selected server is offline", () => {
    setReadiness(readiness([mod({ state: "ready" })]), false);
    const html = renderToStaticMarkup(
      <ElementContextProvider value={{ selectedServer: { online: false, modded: true, mod_count: 1 } as Server }}>
        <ServerDownloadSize />
      </ElementContextProvider>,
    );
    expect(html).toContain('data-state="none offline"');
  });
});
