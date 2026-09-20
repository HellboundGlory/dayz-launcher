import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModReadinessEntry, ServerModReadiness } from "@/types/server";
import { computeReadinessView } from "./readiness-elements";

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

describe("computeReadinessView", () => {
  it("reports checking while the fetch is in flight, regardless of any stale data", () => {
    const view = computeReadinessView(readiness([mod({ state: "ready" })], true), true);
    expect(view.dataState).toBe("checking");
    expect(view.label).toBe("Checking mods…");
    expect(view.sizeBytes).toBeNull();
  });

  it("reports unchecked when no data has resolved", () => {
    const view = computeReadinessView(null, false);
    expect(view.dataState).toBe("unchecked");
    expect(view.label).toBe("Mods not checked");
  });

  it("reports noMods for an empty declared list", () => {
    const view = computeReadinessView(readiness([]), false);
    expect(view.dataState).toBe("noMods");
    expect(view.label).toBe("No mods declared");
  });

  it("reports ready when every mod is ready or not on the workshop", () => {
    const view = computeReadinessView(
      readiness([mod({ state: "ready" }), mod({ state: "not_on_workshop" })]),
      false,
    );
    expect(view.dataState).toBe("ready");
    expect(view.label).toBe("All mods ready");
    expect(view.sizeBytes).toBeNull();
  });

  it("counts mods needing download and sums their full size", () => {
    const view = computeReadinessView(
      readiness([
        mod({ state: "not_installed", size_bytes: 1000 }),
        mod({ state: "not_subscribed", size_bytes: 2000 }),
        mod({ state: "ready" }),
      ]),
      false,
    );
    expect(view.dataState).toBe("needsDownload");
    expect(view.label).toBe("2 to download");
    expect(view.sizeBytes).toBe(3000);
    expect(view.sizeIsUpperBound).toBe(false);
  });

  it("counts mods needing an update and marks the size an upper bound", () => {
    const view = computeReadinessView(
      readiness([mod({ state: "needs_update", size_bytes: 5000, size_is_upper_bound: true })]),
      false,
    );
    expect(view.dataState).toBe("needsUpdate");
    expect(view.label).toBe("1 to update");
    expect(view.sizeBytes).toBe(5000);
    expect(view.sizeIsUpperBound).toBe(true);
  });

  it("prefixes the mixed total 'up to' when any outstanding item is an update", () => {
    const view = computeReadinessView(
      readiness([
        mod({ state: "not_installed", size_bytes: 1000, size_is_upper_bound: false }),
        mod({ state: "needs_update", size_bytes: 4000, size_is_upper_bound: true }),
      ]),
      false,
    );
    expect(view.sizeBytes).toBe(5000);
    expect(view.sizeIsUpperBound).toBe(true);
  });

  it("reports live download progress and replaces the size estimate", () => {
    const view = computeReadinessView(
      readiness([
        mod({ state: "downloading", downloaded_bytes: 512, total_bytes: 2048 }),
        mod({ state: "not_installed", size_bytes: 1000 }),
      ]),
      false,
    );
    expect(view.dataState).toBe("downloading");
    expect(view.label).toBe("Downloading 512 bytes of 2 KB");
    expect(view.sizeBytes).toBe(3048);
  });

  it("takes the first of downloading, needsDownload, needsUpdate, unchecked, noMods, ready", () => {
    const view = computeReadinessView(
      readiness([
        mod({ state: "needs_update" }),
        mod({ state: "not_installed" }),
        mod({ state: "downloading" }),
      ]),
      false,
    );
    expect(view.dataState).toBe("downloading");
  });

  it("carries stale through, overriding the content state on data-state", () => {
    const view = computeReadinessView(readiness([mod({ state: "needs_update", size_bytes: 10 })], true), false);
    expect(view.dataState).toBe("stale");
    expect(view.label).toBe("1 to update");
  });
});

vi.mock("./use-selection-readiness", () => ({
  useSelectionReadiness: vi.fn(),
}));

describe("ServerReadiness", () => {
  async function renderWith(readinessValue: ServerModReadiness | null, loading: boolean) {
    const { useSelectionReadiness } = await import("./use-selection-readiness");
    vi.mocked(useSelectionReadiness).mockReturnValue({ readiness: readinessValue, loading });
    const { ServerReadiness } = await import("./readiness-elements");
    return renderToStaticMarkup(<ServerReadiness />);
  }

  it("renders dot, label and size parts by default", async () => {
    const html = await renderWith(readiness([mod({ state: "not_installed", size_bytes: 1024 })]), false);
    expect(html).toContain('data-el="server.readiness"');
    expect(html).toContain('data-state="needsDownload"');
    expect(html).toContain('data-part="dot"');
    expect(html).toContain('data-part="label"');
    expect(html).toContain("1 to download");
    expect(html).toContain('data-part="size"');
    expect(html).toContain("1 KB");
  });

  it("omits the dot part when showDot is false", async () => {
    const { useSelectionReadiness } = await import("./use-selection-readiness");
    vi.mocked(useSelectionReadiness).mockReturnValue({ readiness: readiness([]), loading: false });
    const { ServerReadiness } = await import("./readiness-elements");
    const html = renderToStaticMarkup(<ServerReadiness options={{ showDot: false }} />);
    expect(html).not.toContain('data-part="dot"');
  });

  it("prefixes the rendered size with 'up to' when an update is outstanding", async () => {
    const { useSelectionReadiness } = await import("./use-selection-readiness");
    vi.mocked(useSelectionReadiness).mockReturnValue({
      readiness: readiness([mod({ state: "needs_update", size_bytes: 1024, size_is_upper_bound: true })]),
      loading: false,
    });
    const { ServerReadiness } = await import("./readiness-elements");
    const html = renderToStaticMarkup(<ServerReadiness />);
    expect(html).toContain("up to 1 KB");
  });

  it("omits the size part when showSize is false", async () => {
    const { useSelectionReadiness } = await import("./use-selection-readiness");
    vi.mocked(useSelectionReadiness).mockReturnValue({
      readiness: readiness([mod({ state: "not_installed", size_bytes: 1024 })]),
      loading: false,
    });
    const { ServerReadiness } = await import("./readiness-elements");
    const html = renderToStaticMarkup(<ServerReadiness options={{ showSize: false }} />);
    expect(html).not.toContain('data-part="size"');
  });
});
