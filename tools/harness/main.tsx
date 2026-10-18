// Headless UI harness: the real App against a faked Tauri backend. See README.md.
import "@/main.css";
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
const readyMods = params.get("mods") === "ready";
// `join=asking|checking|found|noanswer` opens the join-link box in that state.
const joinState = params.get("join");

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
  "layout/popups/mapFilter.json",
  "layout/popups/modsUnique.json",
  "layout/popups/modsUnsubscribe.json",
  "layout/popups/modsVerify.json",
  "layout/popups/regionFilter.json",
  "layout/popups/sort.json",
  "layout/popups/tagsFilter.json",
  "layout/popups/serverActions.json",
  "layout/popups/serverLoad.json",
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
  const schema = (await readJson(`${THEME_ROOT}/${id}/settings.schema.json`)) as Record<
    string,
    unknown
  > | null;
  return {
    ...manifest,
    tokens: await readJson(`${THEME_ROOT}/${id}/tokens.json`),
    // The real backend resolves the schema; no harness shot opens Dev Mode's
    // combination list, so it stays empty here.
    settings: schema ? { fields: schema.fields, combinations: [], capped: false } : null,
    layouts,
    fallbacks: [],
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
  ].map(([name, state]) => [name, readyMods ? "ready" : state]).map(([name, state], i) => ({
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
  get_server_page: (args) => {
    const rows = serverList(args.filterParams as Record<string, unknown> | undefined);
    const page = args.page as { offset: number; limit: number };
    return { total: rows.length, rows: rows.slice(page.offset, page.offset + page.limit) };
  },
  get_map_list: () => maps,
  get_server_counts: () => ({ total: servers.length, populated: servers.filter((s) => s.players > 0).length }),
  server_list_source: () => "steam",
  server_mod_readiness: () => (joinState === "checking" ? new Promise(() => {}) : readiness),
  steam_mod_states: () => [],
  steam_download_progress: () => [],
  dayz_running: () => dayzRunning,
  list_installed_themes: async () => (themeId === "neutral" ? [] : [await themeSummary(themeId)]),
  get_theme: async (args) => themeFile(String(args.id)),
  get_theme_settings_values: () => ({}),
  get_activation_status: () => null,
  validate_theme: () => [],
  data_folder_path: () => "/home/user/.local/share/com.tetra.launcher",
  get_subscribed_mods: () => ({ rows: makeMods(), from_cache: false }),
  get_cared_servers: () => [],
  get_servers_needing: () => [],
  get_mod_usage: () => [],
  get_unique_mods_summary: () => [],
  get_known_mods: () => [],
  get_workshop_previews: () => ({}),
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

// Theme assets are served over tetra-theme://localhost/<id>/ in the app; point them at the package on disk.
// The root layer sheet has no file on disk, so a blob imports the package's styles.css into the theme layer.
const layerSheet = (themeId: string) =>
  URL.createObjectURL(
    new Blob([`@import url("${location.origin}${THEME_ROOT}/${themeId}/styles.css") layer(theme);`], { type: "text/css" }),
  );
const rewrite = (el: Element) => {
  for (const attr of ["href", "src"]) {
    const value = el.getAttribute(attr);
    if (value?.startsWith("tetra-theme://")) {
      const [, id, ...rest] = value.replace("tetra-theme://localhost/", "/").split("/");
      const themeId = decodeURIComponent(id);
      const path = rest.join("/");
      el.setAttribute(attr, path === "theme-layer.css" ? layerSheet(themeId) : `${THEME_ROOT}/${themeId}/${path}`);
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

/** Polls until `check` is truthy; a timeout is recorded in `missing` under `label`. */
async function waitUntil<T>(check: () => T, label: string, timeout = 8000, interval = 50): Promise<T | null> {
  // `performance.now()`: `static=1` freezes the wall clock.
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = check();
    if (value) return value;
    await sleep(interval);
  }
  missing.push(label);
  console.warn(`[harness] never found ${label}`);
  return null;
}

const waitFor = (selector: string) =>
  waitUntil(() => document.querySelector<HTMLElement>(selector), selector);

/**
 * A `click=` target: a CSS selector, `text:<button label>`, or `last-visible:<selector>` (the last match on screen).
 * A disabled target is missing: clicking it does nothing, so its shot would show the wrong state.
 */
function clickTarget(spec: string): HTMLElement | null {
  const enabled = (el: HTMLElement) => !el.matches(":disabled");
  if (spec.startsWith("text:")) {
    const label = spec.slice("text:".length);
    return [...document.querySelectorAll<HTMLElement>("button")].find((el) => el.textContent?.trim() === label && enabled(el)) ?? null;
  }
  if (spec.startsWith("last-visible:")) {
    const shown = [...document.querySelectorAll<HTMLElement>(spec.slice("last-visible:".length))].filter(
      (el) => enabled(el) && fullyOnScreen(el),
    );
    return shown.pop() ?? null;
  }
  const el = document.querySelector<HTMLElement>(spec);
  return el && enabled(el) ? el : null;
}

/** Whether the element's centre is the element itself or one of its children, not something drawn over it. */
function hitsCentre(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return hit !== null && el.contains(hit);
}

/**
 * Scrolls only when the target is cut off vertically or covered (a scroller's footer), and undoes any sideways
 * scroll that brings. Scrolling sideways would shift the whole view.
 */
function scrollIntoWindow(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  if (box.top >= 0 && box.bottom <= window.innerHeight && hitsCentre(el)) return;
  const lefts: [Element, number][] = [];
  for (let node = el.parentElement; node; node = node.parentElement) lefts.push([node, node.scrollLeft]);
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  for (const [node, left] of lefts) node.scrollLeft = left;
}

/** The player can reach the element sideways: it is inside the window and not covered. */
function reachable(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  return box.left >= 0 && box.right <= window.innerWidth && hitsCentre(el);
}

/** The element's row (or the element) is inside the window and not cut off by a scroller. */
function fullyOnScreen(el: HTMLElement): boolean {
  const row = el.closest<HTMLElement>("[data-row]") ?? el;
  const box = row.getBoundingClientRect();
  if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) return false;
  const x = box.left + box.width / 2;
  return [box.top + 1, box.bottom - 1].every((y) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && row.contains(hit);
  });
}

/** Resolves once the DOM has gone `quietMs` without a change and every image has decoded. */
async function settle(quietMs = 100, cap = 3000) {
  let last = performance.now();
  const observer = new MutationObserver(() => {
    last = performance.now();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  await waitUntil(() => performance.now() - last >= quietMs, "a DOM that stops changing", cap, 20);
  observer.disconnect();
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  await nextPaint();
}

/** Resolves on the frame after the next repaint. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function runScenario() {
  await settle();
  const { useServerStore } = await import("@/stores/server-store");
  const view = params.get("view");
  if (view) {
    (await waitFor(`[data-el="nav.${view}"]`))?.click();
    await settle();
  }
  const select = params.get("select");
  if (select !== null || params.get("modal") === "serverInfo") {
    await waitUntil(() => useServerStore.getState().servers.length > 0, "the server list");
  }
  if (select !== null) {
    const list = useServerStore.getState().servers;
    useServerStore.getState().setSelectedServer(list[Number(select)] ?? null);
  }
  const selectMod = params.get("selectMod");
  if (selectMod !== null) {
    const { useModsStore, visibleRows, filterAndSortMods } = await import("@/stores/mods-store");
    await waitUntil(() => visibleRows(useModsStore.getState().rows).length > 0, "the mods list");
    const mods = useModsStore.getState();
    const list = filterAndSortMods(mods.rows, mods);
    useModsStore.getState().openMod(list[Number(selectMod)]?.workshop_id ?? null);
  }
  if (params.get("settings") === "1") {
    (await waitFor('[data-el="nav.settings"]'))?.click();
    const settingsTab = params.get("settingsTab");
    if (settingsTab) {
      await settle();
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
  if (joinState) {
    const { useJoinLinkStore } = await import("@/stores/join-link-store");
    await waitUntil(() => useServerStore.getState().servers.length > 0, "the server list");
    const target = useServerStore.getState().servers[Number(select ?? 0)];
    const store = useJoinLinkStore.getState();
    const request = { ip: target?.addr.split(":")[0] ?? "203.0.113.7", port: target?.query_port ?? 2303, favourite: false };
    store.open(request);
    if (joinState === "noanswer") store.noAnswer(request);
    else if (joinState !== "asking" && target) store.found(request, target);
  }
  let last: HTMLElement | null = null;
  for (const spec of params.getAll("click")) {
    await settle();
    const target = await waitUntil(() => clickTarget(spec), spec);
    if (!target) continue;
    scrollIntoWindow(target);
    if (!reachable(target)) {
      missing.push(spec);
      console.warn(`[harness] cut off sideways: ${spec}`);
      continue;
    }
    target.click();
    last = target;
  }
  // Longer than the app's own debounces (readiness waits 250 ms before it fetches).
  await settle(400);
  if (last) {
    const box = last.getBoundingClientRect();
    harness.pointer = [box.left + box.width / 2, box.top + box.height / 2];
  }
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
  await nextPaint();
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
const { App } = await import("@/App");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
void runScenario();
