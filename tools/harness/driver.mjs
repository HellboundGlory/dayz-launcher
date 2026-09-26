// Shared driver for the headless harness: serves the harness page (dev server or
// a scratch prod build of it), launches the cached headless Chromium, and opens
// scenarios. Imported by the visual and perf harnesses; see README.md.
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
/** Harness entry, relative to ROOT. */
export const ENTRY = "tools/harness/index.html";
/** Theme packages main.tsx fetches over HTTP; the app serves them from here. */
const THEME_ROOT = "src-tauri/resources/builtin-themes";

const OUT = path.join(ROOT, "tools/harness/.out");
const PROD_OUT = path.join(OUT, "prod");
// Distinct defaults so a dev server and a prod preview can run side by side.
const DEFAULT_PORT = { dev: 1431, prod: 1432 };

/** The cached headless shell, newest revision first, `HARNESS_BROWSER` overriding — found as shoot.sh finds it. */
export async function headlessShellPath() {
  if (process.env.HARNESS_BROWSER) return process.env.HARNESS_BROWSER;
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  const revisions = (await readdir(cache).catch(() => []))
    .filter((name) => name.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(a.split("-").pop()) - Number(b.split("-").pop()));
  for (const revision of revisions.reverse()) {
    const exe = path.join(cache, revision, "chrome-linux", "headless_shell");
    if (await stat(exe).then(() => true, () => false)) return exe;
  }
  throw new Error(
    `No headless Chromium under ${cache}: run  npx -y playwright install chromium-headless-shell`,
  );
}

export async function launchBrowser() {
  return chromium.launch({
    executablePath: await headlessShellPath(),
    // Playwright pushes --hide-scrollbars for anything it launches as headless;
    // the headless shell is headless either way, and shoot.sh keeps scrollbars
    // on screen, so the driver must too.
    headless: false,
    args: ["--no-sandbox", "--disable-gpu", "--enable-precise-memory-info"],
  });
}

function spawnServer(args, logName) {
  const logPath = path.join(OUT, logName);
  const fd = openSync(logPath, "a");
  const child = spawn("npx", ["vite", ...args], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  // A caller that forgets stop() should not keep this process alive.
  child.unref();
  return { child, logPath };
}

async function logTail(logPath, lines = 12) {
  try {
    return (await readFile(logPath, "utf8")).split("\n").slice(-lines).join("\n").trim();
  } catch {
    return "(no log)";
  }
}

async function isUp(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, { child, logPath }, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp(url)) return;
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await stopServer(child);
  throw new Error(`Server never answered ${url}\n${await logTail(logPath)}`);
}

async function stopServer(child) {
  if (child === undefined || child.exitCode !== null) return;
  // npx runs vite as a child of its own; killing the group takes both down.
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/**
 * Serve the harness page. `dev` reuses a running Vite on the port, else spawns
 * one (as shoot.sh does); `prod` builds the harness entry into
 * `tools/harness/.out/prod` with the repo's own Vite config and serves that.
 * Resolves to `{ url, port, mode, buildMs?, log, stop() }` where `url` is the
 * harness document itself, ready to hand to `openScenario`.
 */
export async function startServer({ mode = "dev", port } = {}) {
  if (mode !== "dev" && mode !== "prod") throw new Error(`Unknown harness mode "${mode}"`);
  await mkdir(OUT, { recursive: true });
  const listenPort = port ?? Number(process.env.HARNESS_PORT ?? DEFAULT_PORT[mode]);
  // Both modes serve the same document path, so callers hand the url straight to openScenario either way.
  const url = `http://localhost:${listenPort}/${ENTRY}`;

  if (mode === "dev") {
    // A server already on the port is shoot.sh's, shared on purpose — leave it running.
    if (await isUp(url)) return { url, port: listenPort, mode, log: null, stop: async () => {} };
    const server = spawnServer(["--port", String(listenPort), "--strictPort"], "vite-dev.log");
    await waitForUrl(url, server);
    return { url, port: listenPort, mode, log: server.logPath, stop: () => stopServer(server.child) };
  }

  await rm(PROD_OUT, { recursive: true, force: true });
  const started = Date.now();
  const { build } = await import("vite");
  await build({
    root: ROOT,
    configFile: path.join(ROOT, "vite.config.ts"),
    logLevel: "warn",
    build: {
      outDir: PROD_OUT,
      emptyOutDir: true,
      // The app's own target is WebKit-for-Tauri; the harness page uses top-level await.
      target: "es2022",
      minify: "esbuild",
      sourcemap: false,
      // The repo root stays the build root, so Tailwind's content globs and the
      // public dir behave exactly as they do for `npm run build`; the entry
      // lands under tools/harness/ in the out dir, preserving the dev URL.
      rollupOptions: { input: path.join(ROOT, ENTRY) },
    },
  });
  // main.tsx fetches theme packages from an absolute path the app's asset
  // protocol serves; a static copy is what stands in for it.
  await cp(path.join(ROOT, THEME_ROOT), path.join(PROD_OUT, THEME_ROOT), { recursive: true });
  const buildMs = Date.now() - started;
  console.log(`[harness] prod build in ${buildMs} ms -> ${path.relative(ROOT, PROD_OUT)}`);

  const server = spawnServer(
    ["preview", "--port", String(listenPort), "--strictPort", "--outDir", PROD_OUT],
    "vite-preview.log",
  );
  await waitForUrl(url, server);
  return {
    url,
    port: listenPort,
    mode,
    buildMs,
    log: server.logPath,
    stop: async () => {
      await stopServer(server.child);
      // Regenerable, and `eslint .` walks it while it is on disk.
      await rm(PROD_OUT, { recursive: true, force: true });
    },
  };
}

/**
 * A page on the harness entry at `<baseUrl>?<query>`, sized and colour-schemed.
 * Resolves once main.tsx reports `harnessReady` and fonts have settled; console
 * errors are echoed to stderr, and a page error — before or after this returns —
 * lands in `page.harnessErrors` and fails the call.
 */
export async function openScenario(browser, baseUrl, query = "", options = {}) {
  const { width = 1400, height = 800, scale = 1, scheme } = options;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    ...(scheme === undefined ? {} : { colorScheme: scheme }),
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleErrors.push(message.text());
    process.stderr.write(`[harness:console] ${message.text()}\n`);
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error);
    process.stderr.write(`[harness:pageerror] ${error.stack ?? error.message}\n`);
  });
  page.harnessConsoleErrors = consoleErrors;
  page.harnessErrors = pageErrors;

  const target = new URL(baseUrl);
  if (query) target.search = query.startsWith("?") ? query : `?${query}`;
  await page.goto(target.href, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.dataset.harnessReady === "1", undefined, {
    timeout: 30_000,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  if (pageErrors.length > 0) {
    throw new Error(
      `Harness page error at ${target.href}\n${pageErrors.map((e) => e.stack ?? e.message).join("\n")}`,
    );
  }
  return page;
}
