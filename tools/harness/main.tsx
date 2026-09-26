// Headless UI harness: the real App against a faked Tauri backend. See README.md.
import React from "react";
import ReactDOM from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { makeMods, makeServers, maps } from "./fixtures";
import { REGISTRY } from "@/theme/registry";
import { runVisibilityCheck } from "@/theme/fallback/visibility";
import type { Server } from "@/types/server";

const params = new URLSearchParams(location.search);
const themeId = params.get("theme") ?? "builtin.tactical";
const scheme = params.get("scheme");
const servers = makeServers(Number(params.get("servers") ?? 120));
const dayzRunning = params.get("dayz") === "1";
const storageDegraded = params.get("storage") === "degraded";
const mixedMods = params.get("mods") === "mixed";

// `static=1` (the visual harness): pin the clock and kill motion and the caret,
// so two shots of the same tree are byte-identical. Midday so a ±12h timezone
// still lands on the same calendar day in the rendered dates.
const FROZEN_NOW = Date.UTC(2025, 9, 1, 12, 34, 56);
if (params.get("static") === "1") {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(FROZEN_NOW);
      else super(...(args as [number]));
    }
    static now = () => FROZEN_NOW;
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
  const style = document.createElement("style");
  style.textContent =
    "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.head.append(style);
}
const THEME_ROOT = "/src-tauri/resources/builtin-themes";
const LAYOUTS = [
  "layout/shell.json",
  "layout/settings.json",
  "layout/views/browser.json",
  "layout/views/mods.json",
  "layout/modals/serverInfo.json",
  "layout/modals/modFilter.json",
  "layout/modals/update.json",
  "layout/lists/servers.json",
  "layout/lists/mods.json",
  "layout/lists/serverMods.json",
  "layout/lists/modServers.json",
  "layout/lists/modFilterResults.json",
];

async function readJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) return null;
  const text = await res.text();
  return text.trimStart().startsWith("<") ? null : JSON.parse(text);
}

async function themeSummary(id: string) {
  const manifest = (await readJson(`${THEME_ROOT}/${id}/theme.json`)) as Record<string, unknown>;
  return { tier: "expert", preview: null, previews: [], ...manifest };
}

async function themeFile(id: string) {
  const manifest = (await readJson(`${THEME_ROOT}/${id}/theme.json`)) as Record<string, unknown>;
  const layouts: Record<string, unknown> = {};
  for (const path of LAYOUTS) {
    const layout = await readJson(`${THEME_ROOT}/${id}/${path}`);
    if (layout) layouts[path] = layout;
  }
  return {
    ...manifest,
    tokens: await readJson(`${THEME_ROOT}/${id}/tokens.json`),
    layout: null,
    settingsSchema: await readJson(`${THEME_ROOT}/${id}/settings.schema.json`),
    components: {},
    layouts,
  };
}

function serverList(filter: Record<string, unknown> | undefined): Server[] {
  if (filter?.favourites_only) return servers.filter((s) => s.favourite);
  if (filter?.recent_only) return servers.filter((s) => s.last_played !== null);
  return servers;
}

// `mods=mixed` puts one declared mod mid-download, so the readiness strip and
// list show progress next to the ready/outdated/unsubscribed ones.
const readiness = {
  stale: false,
  mods: [
    ["CF", "ready"],
    ["Community Online Tools", mixedMods ? "downloading" : "ready"],
    ["DayZ-Expansion-Bundle", "needs_update"],
    ["Trader", "not_subscribed"],
  ].map(([name, state], i) => ({
    workshop_id: String(1559212036 + i),
    name,
    state,
    size_bytes: state === "ready" ? null : 1_200_000_000,
    size_is_upper_bound: state === "needs_update",
    preview_url: null,
    is_unique: false,
    downloaded_bytes: state === "downloading" ? 400_000_000 : null,
    total_bytes: state === "downloading" ? 1_200_000_000 : null,
  })),
};

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  get_settings: () => ({
    profileName: "Survivor",
    steamPath: "/home/user/.local/share/Steam",
    dayzPath: "/home/user/.local/share/Steam/steamapps/common/DayZ",
    workshopPath: "/home/user/.local/share/Steam/steamapps/workshop/content/221100",
    maxConcurrentQueries: 256,
    queryTimeoutMs: 1000,
    launchParams: [],
    closeToTray: false,
    minimiseToTray: true,
    uiScale: 1.25,
    autoRefreshIntervalSecs: 0,
    startWithWindows: false,
    startMinimised: false,
    onJoin: "tray",
    onboardingDismissed: true,
    discordRichPresence: true,
    activeThemeId: themeId === "neutral" ? null : themeId,
  }),
  steam_init: () => null,
  steam_connection_state: () => true,
  registry_degraded: () => storageDegraded,
  discover_servers: () => null,
  get_server_list: (args) => serverList(args.filter as Record<string, unknown> | undefined),
  get_map_list: () => maps,
  get_server_counts: () => ({ total: servers.length, populated: servers.filter((s) => s.players > 0).length }),
  server_list_source: () => "steam",
  server_mod_readiness: () => readiness,
  get_server_mods: () => readiness.mods.map((m) => ({ workshop_id: m.workshop_id, name: m.name })),
  steam_mod_states: () => [],
  steam_download_progress: () => [],
  dayz_running: () => dayzRunning,
  list_installed_themes: async () => (themeId === "neutral" ? [] : [await themeSummary(themeId)]),
  get_theme: async (args) => themeFile(String(args.id)),
  get_theme_settings_values: () => ({}),
  get_activation_status: () => null,
  list_starter_templates: () => [],
  data_folder_path: () => "/home/user/.local/share/com.tetra.launcher",
  get_subscribed_mods: () => ({ rows: makeMods(), from_cache: false }),
  get_cared_servers: () => [],
  get_servers_needing: () => [],
  get_mod_usage: () => [],
  get_unique_mods_summary: () => [],
  get_known_mods: () => [],
  "plugin:window|get_all_windows": () => ["main", "splash"],
};

// Paint uncaught errors onto the page so a crash is visible in the screenshot.
const showError = (message: string) => {
  const box = document.createElement("pre");
  box.textContent = message;
  box.style.cssText =
    "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;margin:0;padding:8px;max-height:45vh;overflow:auto;background:#300;color:#fcc;font:11px monospace;white-space:pre-wrap";
  document.body.appendChild(box);
};
window.addEventListener("error", (e) => showError(`${e.message}\n${e.error?.stack ?? ""}`));
window.addEventListener("unhandledrejection", (e) => showError(`Unhandled rejection: ${String(e.reason?.stack ?? e.reason)}`));
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleError(...args);
  showError(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "));
};

mockWindows("main", "splash");
mockIPC(
  async (cmd, payload) => {
    const handler = handlers[cmd];
    if (handler) return handler((payload ?? {}) as Record<string, unknown>);
    if (!cmd.startsWith("plugin:")) console.warn(`[harness] unmocked command ${cmd}`);
    return null;
  },
  { shouldMockEvents: true },
);

// Theme assets are served over tetra-theme:// in the app; point them at the package on disk.
const rewrite = (el: Element) => {
  for (const attr of ["href", "src"]) {
    const value = el.getAttribute(attr);
    if (value?.startsWith("tetra-theme://")) {
      const [, id, ...rest] = value.replace("tetra-theme://", "/").split("/");
      el.setAttribute(attr, `${THEME_ROOT}/${decodeURIComponent(id)}/${rest.join("/")}`);
    }
  }
};
new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "attributes") rewrite(r.target as Element);
    r.addedNodes.forEach((n) => n instanceof Element && [n, ...n.querySelectorAll("[href],[src]")].forEach(rewrite));
  }
}).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["href", "src"] });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Selectors a scenario asked for and never found: the shot shows the wrong state. */
const missing: string[] = [];

async function waitFor(
  selector: string,
  timeout = 8000,
  { optional = false }: { optional?: boolean } = {},
): Promise<HTMLElement | null> {
  // `performance.now()`: `static=1` freezes the wall clock.
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
    await sleep(50);
  }
  if (!optional) missing.push(selector);
  console.warn(`[harness] never found ${selector}`);
  return null;
}

async function runScenario() {
  // Neutral renders the base components (data-tetra-el hooks); a theme package
  // renders the element pipeline (data-el). Either proves the list painted — and
  // an empty list has none of them, so this one is allowed to miss.
  await waitFor('[data-list="servers"] [data-row], [data-el="list.servers"], [data-tetra-el="name"]', 8000, {
    optional: true,
  });
  await sleep(300);
  const { useServerStore } = await import("@/stores/server-store");
  const view = params.get("view");
  if (view) (await waitFor(`[data-el="nav.${view}"]`))?.click();
  await sleep(300);
  const select = params.get("select");
  if (select !== null) {
    const list = useServerStore.getState().servers;
    useServerStore.getState().setSelectedServer(list[Number(select)] ?? null);
  }
  const selectMod = params.get("selectMod");
  if (selectMod !== null) {
    const { useModsStore, visibleRows } = await import("@/stores/mods-store");
    const { filterAndSortMods } = await import("@/components/mods-tab");
    const start = performance.now();
    while (visibleRows(useModsStore.getState().rows).length === 0 && performance.now() - start < 8000) {
      await sleep(50);
    }
    const mods = useModsStore.getState();
    const list = filterAndSortMods(mods.rows, mods);
    useModsStore.getState().openMod(list[Number(selectMod)]?.workshop_id ?? null);
  }
  if (params.get("settings") === "1") {
    (await waitFor('[data-el="nav.settings"]'))?.click();
    const settingsTab = params.get("settingsTab");
    if (settingsTab) {
      await sleep(200);
      const tab = [...document.querySelectorAll<HTMLElement>('[data-part="tab"]')].find(
        (el) => el.dataset.tab === settingsTab || el.textContent?.trim() === settingsTab,
      );
      tab?.click();
    }
  }
  const popup = params.get("popup");
  if (popup) (await waitFor(`[data-el="filter.${popup}"] [data-part="trigger"]`))?.click();
  const modal = params.get("modal");
  if (modal) {
    const harness = (window as unknown as { __harness?: Record<string, (...args: unknown[]) => unknown> }).__harness;
    if (modal === "serverInfo") {
      const list = useServerStore.getState().servers;
      harness?.openServerInfo(list[Number(select ?? 0)] ?? list[0]);
    } else if (modal === "modFilter") {
      harness?.openModFilter();
    } else if (modal === "update") {
      harness?.openUpdateModal();
    }
  }
  for (const selector of params.getAll("click")) {
    await sleep(200);
    (await waitFor(selector))?.click();
  }
  await sleep(600);
  document.body.dataset.harnessReady = "1";
}

// Imported only after the mocks are installed: the app's modules capture the
// mocked backend when they load.
const { useThemeStore } = await import("@/theme/theme-store");

// App.tsx reassigns window.__harness on every render; merge instead of letting
// either side clobber the other.
const harness: Record<string, unknown> = {};
Object.defineProperty(window, "__harness", {
  configurable: true,
  get: () => harness,
  set: (value: Record<string, unknown>) => Object.assign(harness, value),
});

// Selectors a scenario asked for and never found, so a caller (the visual
// harness) can refuse to treat the shot as a baseline.
harness.missing = missing;

// The store's activation path — what the Themes page calls — resolving on the
// frame after the repaint, so the perf harness can time apply-to-first-paint.
harness.activate = async (id: string) => {
  await useThemeStore.getState().pickTheme(id);
  const painted = Promise.withResolvers<void>();
  requestAnimationFrame(() => requestAnimationFrame(() => painted.resolve()));
  await painted.promise;
};

// Why each screen fell back, keyed by layout file.
harness.fallbackReasons = async () => (await import("@/theme/fallback/store")).useFallbackStore.getState().fallbackReasons;

// Runs the fallback visibility check over every registry element that needs to
// be on screen somewhere (registry.json's non-empty `required`), for perf.mjs.
harness.visibilityCheck = () => {
  const requiredElements = Object.entries(REGISTRY.elements)
    .filter(([, def]) => def.required.length > 0)
    .map(([id]) => id);
  return runVisibilityCheck({ requiredElements });
};

// Awaited so a `scheme=` override still precedes the first render.
await useThemeStore.getState().hydrate();
if (scheme === "dark" || scheme === "light") useThemeStore.getState().setScheme(scheme);
await import("@/main.css");
const { App } = await import("@/App");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
void runScenario();
