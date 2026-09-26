import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearFallbackMemory, markFileFallback } from "./theme/fallback/store";
import { SHELL_LAYOUT, BROWSER_LAYOUT, MODS_LAYOUT } from "./theme/neutral";
import type { useThemeStore } from "./theme/theme-store";
import type { LayoutFile } from "./theme/renderer/types";
import type { ThemeFile } from "./types/theme";

type ThemeStoreHook = typeof useThemeStore;

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "2.6.0" }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
    startDragging: () => {},
  }),
  getAllWindows: async () => [],
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

// A server render reads zustand's frozen initial snapshot, which still says
// "neutral"; the real store hook behind it would disagree with the imperative
// getters beside it. Point the hook at the live state so one render sees both.
const realStore = vi.hoisted(() => ({ hook: null as unknown }));

vi.mock("./theme/theme-store", async (importOriginal) => {
  const actual = (await importOriginal()) as { useThemeStore: ThemeStoreHook };
  realStore.hook = actual.useThemeStore;
  return {
    ...actual,
    useThemeStore: (selector: (state: unknown) => unknown) =>
      selector(actual.useThemeStore.getState()),
  };
});

import { App } from "./App";

const themeStore = realStore.hook as ThemeStoreHook;

function themeFile(layouts: Record<string, LayoutFile>): ThemeFile {
  return {
    schemaVersion: 2,
    id: "local.aurora",
    name: "Aurora",
    author: "local",
    version: "1.0.0",
    themeApi: "2.0",
    minimumLauncherVersion: "0.0.0",
    description: "",
    preview: null,
    license: null,
    homepage: null,
    tags: [],
    capabilities: ["tokens", "layouts"],
    tokens: {},
    settingsSchema: null,
    layouts,
    fallbacks: [],
  };
}

function themed(layouts: Record<string, LayoutFile>): void {
  themeStore.setState({
    activeId: "local.aurora",
    themeFiles: { "local.aurora": themeFile(layouts) },
  });
}

const ALL_SCREENS = {
  "layout/shell.json": SHELL_LAYOUT,
  "layout/views/browser.json": BROWSER_LAYOUT,
  "layout/views/mods.json": MODS_LAYOUT,
};

/** The pipeline's shell renders the window controls as a surface; the legacy
 * shell renders the launcher's own component, which has no such marker. */
const PIPELINE_SHELL = 'data-surface="surface.windowControls"';
/** The legacy server list; the pipeline's list host carries `data-el` instead. */
const LEGACY_LIST = "l2-body";

beforeEach(() => {
  themeStore.setState({ activeId: "neutral", themeFiles: {} });
  clearFallbackMemory();
});

describe("App screen source", () => {
  it("draws Neutral through the launcher's legacy components", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).not.toContain(PIPELINE_SHELL);
    expect(html).toContain(LEGACY_LIST);
  });

  it("draws a theme's own shell and views through the pipeline", () => {
    themed(ALL_SCREENS);

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain(PIPELINE_SHELL);
    expect(html).toContain('data-surface="surface.filterBar"');
    expect(html).not.toContain(LEGACY_LIST);
  });

  it("drops only a fallen-back view to the legacy list, keeping the theme's shell", () => {
    themed(ALL_SCREENS);
    markFileFallback("local.aurora", "layout/views/browser.json", "LAY-01: dropped");

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain(PIPELINE_SHELL);
    expect(html).not.toContain('data-surface="surface.filterBar"');
    expect(html).toContain(LEGACY_LIST);
  });

  it("drops a fallen-back shell to the legacy shell", () => {
    themed(ALL_SCREENS);
    markFileFallback("local.aurora", "layout/shell.json", "LAY-01: dropped");

    const html = renderToStaticMarkup(<App />);

    expect(html).not.toContain(PIPELINE_SHELL);
    expect(html).not.toContain('data-surface="surface.filterBar"');
    expect(html).toContain(LEGACY_LIST);
  });

  it("shows the fallback notice for a themed file and never for Neutral", () => {
    expect(renderToStaticMarkup(<App />)).not.toContain('data-part="fallback-notice"');

    themed(ALL_SCREENS);
    markFileFallback("local.aurora", "layout/views/browser.json", "LAY-01: dropped");

    expect(renderToStaticMarkup(<App />)).toContain('data-part="fallback-notice"');
  });
});
