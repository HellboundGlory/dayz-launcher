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

import { App, SettingsSurface } from "./App";
import { getActiveLayout } from "./theme/theme-store";
import type { SettingsLayoutFile } from "./theme/renderer/types";

const themeStore = realStore.hook as ThemeStoreHook;

const noop = () => {};

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
    settings: null,
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

/** The shell's window controls, drawn through the pipeline. */
const PIPELINE_SHELL = 'data-surface="surface.windowControls"';
const PIPELINE_LIST = 'data-el="list.servers"';

beforeEach(() => {
  themeStore.setState({ activeId: "neutral", themeFiles: {}, incompatibleSwitch: null });
  clearFallbackMemory();
});

describe("App screen source", () => {
  it.each(["layout/views/browser.json", "layout/shell.json"])(
    "draws the shell and browser through the pipeline when a theme's %s fell back",
    (file) => {
      themed(ALL_SCREENS);
      markFileFallback(file, "LAY-01: dropped");

      const html = renderToStaticMarkup(<App />);

      expect(html).toContain(PIPELINE_SHELL);
      expect(html).toContain(PIPELINE_LIST);
    },
  );

  it("shows the fallback notice for a themed file and never for Neutral", () => {
    expect(renderToStaticMarkup(<App />)).not.toContain('data-part="fallback-notice"');

    themed(ALL_SCREENS);
    markFileFallback("layout/views/browser.json", "LAY-01: dropped");

    expect(renderToStaticMarkup(<App />)).toContain('data-part="fallback-notice"');
  });

  it("shows the incompatible-theme notice once", () => {
    themeStore.setState({ incompatibleSwitch: { id: "local.old", name: "Old Timer" } });

    const notices = () => renderToStaticMarkup(<App />).split('data-part="incompatible-theme-notice"').length - 1;

    expect(notices()).toBe(1);

    themed(ALL_SCREENS);

    expect(notices()).toBe(1);
  });
});

/** What the pipeline's Settings host draws. */
const PIPELINE_SETTINGS = 'data-settings-host=""';

const SETTINGS_ROOT = {
  type: "stack" as const,
  direction: "column" as const,
  children: [{ type: "text" as const, role: "heading" as const, value: "Settings" }],
};

const THEMED_SETTINGS_VIEW: SettingsLayoutFile = {
  schemaVersion: 2,
  presentation: { mode: "view" },
  root: SETTINGS_ROOT,
};

const THEMED_SETTINGS_OVERLAY: SettingsLayoutFile = {
  schemaVersion: 2,
  presentation: { mode: "overlay", region: "r-main" },
  root: SETTINGS_ROOT,
};

describe("Themed settings surface", () => {
  /** App hands `SettingsSurface` the active file: the theme's own, else Neutral's. */
  const surface = (placement?: "outlet" | "overlay") => (
    <SettingsSurface
      layout={getActiveLayout("layout/settings.json") as SettingsLayoutFile}
      placement={placement}
      onClose={noop}
    />
  );

  it("draws a theme's own settings.json through the pipeline", () => {
    themed({ ...ALL_SCREENS, "layout/settings.json": THEMED_SETTINGS_VIEW });

    const html = renderToStaticMarkup(surface("outlet"));

    expect(html).toContain(PIPELINE_SETTINGS);
  });

  it("keeps a theme-owned overlay out of the view outlet", () => {
    themed({ ...ALL_SCREENS, "layout/settings.json": THEMED_SETTINGS_OVERLAY });

    const html = renderToStaticMarkup(surface("outlet"));

    expect(html).not.toContain(PIPELINE_SETTINGS);
  });
});
