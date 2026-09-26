// Visual regression harness (SPEC §25): renders the scenario matrix in the
// headless browser and records or checks PNG baselines. Local only — no CI gate,
// and the baselines are gitignored.
//
//   node tools/harness/visual.mjs record [--filter <substring>] [--theme <id>]
//   node tools/harness/visual.mjs check  [--filter <substring>] [--theme <id>]
//
// `record` writes tools/harness/baselines/<theme>/<scheme>-<w>x<h>-<scenario>.png;
// `check` shoots into tools/harness/.out/visual and diffs against those.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { launchBrowser, openScenario, ROOT, startServer } from "./driver.mjs";

// `static=1` freezes the clock; the rendered dates (mod list, last-played) must
// not follow the machine's timezone either.
process.env.TZ = "UTC";

const BASELINES = path.join(ROOT, "tools/harness/baselines");
const OUT = path.join(ROOT, "tools/harness/.out/visual");
const THEME_ROOT = path.join(ROOT, "src-tauri/resources/builtin-themes");

const THEMES = ["neutral", "builtin.tactical"];
const SCHEMES = ["dark", "light"];
const SIZES = [
  [1400, 800],
  [975, 620],
];

/** `click=` for a legacy (`data-tetra-el`) hook, encoded for a query string. */
function legacyClick(hook, tail = "") {
  return new URLSearchParams([["click", `[data-tetra-el="${hook}"]${tail}`]]).toString();
}

/**
 * The matrix, one row per scenario. `neutral` is the query that reaches the same
 * state under theme=neutral, whose legacy components carry `data-tetra-el` hooks
 * instead of `data-el`.
 */
const SCENARIOS = [
  { id: "browser", query: "" },
  { id: "servers0", query: "servers=0" },
  { id: "select3", query: "select=3" },
  { id: "storage-degraded", query: "storage=degraded" },
  { id: "view-favourites", query: "view=favourites", neutral: legacyClick("navFavourites") },
  { id: "view-recent", query: "view=recent", neutral: legacyClick("navRecent") },
  { id: "view-mods", query: "view=mods", neutral: legacyClick("navMods") },
  {
    id: "view-mods-selectmod0",
    query: "view=mods&selectMod=0",
    neutral: `selectMod=0&${legacyClick("navMods")}`,
  },
  { id: "settings", query: "settings=1", neutral: legacyClick("settingsEntry") },
  { id: "popup-map", query: "popup=map", neutral: legacyClick("mapFilter", " button") },
  { id: "popup-tags", query: "popup=tags", neutral: legacyClick("tagsFilter", " button") },
  { id: "popup-region", query: "popup=region", neutral: legacyClick("countryFilter", " button") },
  { id: "modal-serverinfo", query: "modal=serverInfo" },
  { id: "modal-modfilter", query: "modal=modFilter" },
  { id: "modal-update", query: "modal=update" },
  // `mods=mixed` only shows where the declared mods are read (SPEC §11.2).
  { id: "modal-serverinfo-modsmixed", query: "modal=serverInfo&mods=mixed" },
];

/** Tab ids of a theme's Settings layout — one shot each. */
async function settingsTabIds(theme) {
  const file = path.join(THEME_ROOT, theme, "layout/settings.json");
  const layout = await readFile(file, "utf8").then(JSON.parse, () => null);
  if (!layout) return [];
  const ids = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type === "tabs") for (const tab of node.tabs ?? []) ids.push(String(tab.id));
    Object.values(node).forEach(visit);
  };
  visit(layout);
  return ids;
}

function flagValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function readPng(file) {
  const buffer = await readFile(file).catch(() => null);
  return buffer === null ? null : PNG.sync.read(buffer);
}

/** Every shot in the matrix, plus the combinations the harness cannot drive. */
async function buildMatrix(themes) {
  const shots = [];
  const skips = [];
  const tabsByTheme = new Map();
  for (const theme of themes) tabsByTheme.set(theme, await settingsTabIds(theme));
  const knownTabs = [...new Set([...tabsByTheme.values()].flat())];

  for (const theme of themes) {
    const tabs = tabsByTheme.get(theme);
    if (tabs.length === 0 && knownTabs.length > 0) {
      skips.push({
        count: knownTabs.length * SCHEMES.length * SIZES.length,
        label: `${theme} · ${knownTabs.map((tab) => `settings-${tab}`).join(", ")}`,
        reason: "its Settings is one scrolling accordion — no `data-tab` to click",
      });
    }
    const rows = [
      ...SCENARIOS,
      ...tabs.map((tab) => ({ id: `settings-${tab}`, query: `settings=1&settingsTab=${tab}` })),
    ];
    for (const row of rows) {
      const base = theme === "neutral" && row.neutral !== undefined ? row.neutral : row.query;
      for (const scheme of SCHEMES) {
        for (const [width, height] of SIZES) {
          shots.push({
            rel: `${theme}/${scheme}-${width}x${height}-${row.id}.png`,
            scheme,
            width,
            height,
            query: [`theme=${theme}`, base, `scheme=${scheme}`, "static=1"].filter(Boolean).join("&"),
          });
        }
      }
    }
  }
  return { shots, skips };
}

/** Record a baseline, or diff the shot against one. */
async function store(mode, shot, png) {
  const out = path.join(OUT, shot.rel);
  if (mode === "record") {
    const baseline = path.join(BASELINES, shot.rel);
    await mkdir(path.dirname(baseline), { recursive: true });
    await writeFile(baseline, png);
    return { status: "recorded", changed: 0, total: 0 };
  }

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, png);
  const baseline = await readPng(path.join(BASELINES, shot.rel));
  if (baseline === null) return { status: "missing", changed: 0, total: 0 };
  const shotPng = PNG.sync.read(png);
  const total = shotPng.width * shotPng.height;
  if (baseline.width !== shotPng.width || baseline.height !== shotPng.height) {
    return { status: "size", changed: 0, total };
  }
  const diff = new PNG({ width: shotPng.width, height: shotPng.height });
  const changed = pixelmatch(baseline.data, shotPng.data, diff.data, shotPng.width, shotPng.height, {
    threshold: 0.1,
    includeAA: false,
  });
  if (changed > 0) {
    await writeFile(out.replace(/\.png$/, ".diff.png"), PNG.sync.write(diff));
    return { status: "diff", changed, total };
  }
  return { status: "ok", changed: 0, total };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== "record" && mode !== "check") {
    throw new Error("usage: visual.mjs record|check [--filter <substring>] [--theme <id>]");
  }
  const filter = flagValue(args, "--filter");
  const themeFilter = flagValue(args, "--theme");
  const themes = themeFilter === null ? THEMES : THEMES.filter((theme) => theme === themeFilter);
  if (themes.length === 0) throw new Error(`unknown theme "${themeFilter}" (${THEMES.join(", ")})`);

  const { shots: allShots, skips } = await buildMatrix(themes);
  const shots = filter === null ? allShots : allShots.filter((shot) => shot.rel.includes(filter));
  if (shots.length === 0) throw new Error(`no scenarios match --filter "${filter}"`);

  const started = Date.now();
  console.log(`${mode}: ${shots.length} shot(s)${filter === null ? "" : ` matching "${filter}"`}`);
  if (mode === "check") await rm(OUT, { recursive: true, force: true });

  // One prod build serves the whole matrix; `modal=` is reachable there too
  // (App exposes the openers whenever `window.__harness` exists).
  const server = await startServer({
    mode: "prod",
    port: Number(process.env.HARNESS_PORT ?? (await freePort())),
  });
  const browser = await launchBrowser();

  const rows = [];
  try {
    for (const [i, shot] of shots.entries()) {
      const shotStarted = Date.now();
      let page = null;
      let result;
      try {
        page = await openScenario(browser, server.url, shot.query, {
          width: shot.width,
          height: shot.height,
          scale: 1,
          scheme: shot.scheme,
        });
        // A query whose hook never appeared shot the wrong screen; a baseline for
        // it would be a lie, so report it instead of writing one.
        const missing = await page.evaluate(() => window.__harness?.missing ?? []);
        const png = await page.screenshot({ type: "png" });
        result =
          missing.length > 0
            ? { status: "no-hook", changed: 0, total: 0, note: `never found ${missing.join(", ")}` }
            : await store(mode, shot, png);
      } catch (error) {
        result = { status: "error", changed: 0, total: 0, note: String(error).split("\n")[0] };
      } finally {
        await page?.context().close().catch(() => {});
      }
      process.stderr.write(
        `[${i + 1}/${shots.length}] ${((Date.now() - shotStarted) / 1000).toFixed(1)}s ${shot.rel}\n`,
      );
      rows.push({ shot, ...result });
      if (mode === "record") {
        console.log(result.status === "recorded" ? `recorded  ${shot.rel}` : `FAILED    ${shot.rel} — ${result.note}`);
      }
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  if (mode === "record") {
    const written = rows.filter((row) => row.status === "recorded").length;
    console.log("");
    console.log(
      `${written}/${rows.length} baseline(s) written to ${path.relative(ROOT, BASELINES)} in ${(
        (Date.now() - started) / 1000
      ).toFixed(1)} s`,
    );
    if (written !== rows.length) process.exitCode = 1;
  } else {
    console.log("");
    console.log("  status     diff px    % pixels  file");
    for (const row of rows) {
      const pct = row.total > 0 && row.changed > 0 ? `${((row.changed / row.total) * 100).toFixed(2)}%` : "";
      console.log(
        `  ${row.status.padEnd(9)} ${String(row.changed).padStart(8)}  ${pct.padStart(9)}  ` +
          `${row.shot.rel}${row.note === undefined ? "" : `  — ${row.note}`}`,
      );
    }

    const failed = rows.filter((row) => row.status !== "ok");
    console.log("");
    console.log(
      `${rows.length} shot(s) in ${((Date.now() - started) / 1000).toFixed(1)} s · ` +
        `${rows.length - failed.length} unchanged · ${failed.length} failed`,
    );
    if (failed.length > 0) {
      console.log("");
      console.log("failures:");
      for (const { shot, ...row } of failed) {
        if (row.status === "missing") console.log(`  no baseline   ${path.join(BASELINES, shot.rel)}`);
        else if (row.status === "size") console.log(`  size differs  ${path.join(OUT, shot.rel)}`);
        else console.log(`  ${row.changed} px  ${path.join(OUT, shot.rel)}`);
      }
      process.exitCode = 1;
    }
  }

  if (skips.length > 0) {
    console.log("");
    console.log("skipped:");
    for (const skip of skips) {
      console.log(`  ${skip.count} shot(s) — ${skip.label}: ${skip.reason}`);
    }
  }
}

await main();
