#!/usr/bin/env node
// `npm run perf` — the SPEC §24 performance budgets, measured in the headless
// harness (see README.md). Headless Chromium is not the WebKitGTK build the
// launcher ships, so these numbers are indicative, not release figures.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, launchBrowser, openScenario, startServer } from "./driver.mjs";

const OUT = path.join(ROOT, "tools/harness/.out");
const VIEWPORT = { width: 1400, height: 800, scale: 1 };
const ROWS = 27_000;
const SCROLL = { step: 120, durationMs: 5000, warmupMs: 800 };
const ACTIVATION_RUNS = 5;
const VISIBILITY_RUNS = 20;
const BUDGETS = { fps: 55, activationMs: 300, visibilityMs: 16, memoryRatio: 1.1 };

// Scroll viewports: the theme pipeline tags its list root, neutral's base
// components only carry row hooks, so the walk to the scroller starts from a row.
const SCROLL_SEED = {
  "builtin.tactical": '[data-list="servers"] [data-row]',
  neutral: '[data-tetra-el="name"]',
};

const alwaysOk = process.argv.slice(2).includes("--no-fail");

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const highest = (values) => Math.max(...values);
const round = (value, digits = 1) => Number(value.toFixed(digits));

/** Scroll the servers list by a fixed step every frame for 5 s and time the frames. */
async function measureScroll(page, seed) {
  const stats = await page.evaluate(
    async ({ seed, step, durationMs, warmupMs }) => {
      // The virtualizer's scroller is the nearest scrollable ancestor of a row.
      let el = document.querySelector(seed);
      let scroller = null;
      while (el) {
        const style = getComputedStyle(el);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1) {
          scroller = el;
          break;
        }
        el = el.parentElement;
      }
      if (!scroller) throw new Error(`no scroll viewport above ${seed}`);
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

      // Track the position locally: reading scrollTop after writing it would
      // force a synchronous layout every frame and swamp the numbers.
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      let position = scroller.scrollTop;
      let dir = 1;
      const advance = () => {
        position += dir * step;
        if (position >= maxScroll) {
          position = maxScroll;
          dir = -1;
        } else if (position <= 0) {
          position = 0;
          dir = 1;
        }
        scroller.scrollTop = position;
      };

      // Warm up: mount a spread of rows so the timed pass isn't paying first-mount costs.
      const warmEnd = performance.now() + warmupMs;
      while (performance.now() < warmEnd) {
        advance();
        await nextFrame();
      }

      const timestamps = [];
      const start = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          timestamps.push(now);
          advance();
          if (now - start >= durationMs) resolve();
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });

      const intervals = [];
      for (let i = 1; i < timestamps.length; i++) intervals.push(timestamps[i] - timestamps[i - 1]);
      const sorted = [...intervals].sort((a, b) => a - b);
      const span = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
      const mean = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;
      return {
        frames: timestamps.length,
        seconds: span,
        meanFps: (timestamps.length - 1) / span,
        meanFrameMs: mean,
        p95FrameMs: sorted[Math.ceil(0.95 * sorted.length) - 1],
        maxFrameMs: sorted[sorted.length - 1],
        framesOver33ms: intervals.filter((d) => d > 33).length,
        rows: scroller.querySelectorAll('[data-row], [data-tetra-el="name"]').length,
      };
    },
    { seed, ...SCROLL },
  );
  return stats;
}

/**
 * Time `__harness.activate("builtin.tactical")` from neutral. The page is loaded
 * with the package installed: the fixture only reports the page's own theme as
 * installed, so a `theme=neutral` load has nothing to activate.
 */
async function measureActivation(page) {
  const runs = await page.evaluate(async (runCount) => {
    const out = [];
    // One untimed switch so the first timed run isn't paying JIT and first-paint costs.
    await window.__harness.activate("neutral");
    await window.__harness.activate("builtin.tactical");
    await window.__harness.activate("neutral");
    for (let i = 0; i < runCount; i++) {
      const started = performance.now();
      await window.__harness.activate("builtin.tactical");
      out.push(performance.now() - started);
      await window.__harness.activate("neutral");
    }
    return out;
  }, ACTIVATION_RUNS);
  return { runs, medianMs: median(runs), maxMs: highest(runs) };
}

/** Time the fallback visibility check, or reuse `tetra:visibility-check` measures when a package emits them. */
async function measureVisibility(page) {
  const measured = await page.evaluate(() =>
    performance.getEntriesByName("tetra:visibility-check").map((entry) => entry.duration),
  );
  if (measured.length > 0) {
    return { source: "performance-measure", runs: measured, medianMs: median(measured), maxMs: highest(measured) };
  }

  const runs = await page.evaluate(async (runCount) => {
    window.__harness.visibilityCheck(); // untimed warm-up
    const out = [];
    for (let i = 0; i < runCount; i++) {
      const started = performance.now();
      const result = window.__harness.visibilityCheck();
      out.push({ ms: performance.now() - started, passed: result.passed, failures: result.failures.length });
    }
    return out;
  }, VISIBILITY_RUNS);
  const times = runs.map((run) => run.ms);
  const last = runs[runs.length - 1];
  return {
    source: "__harness.visibilityCheck",
    runs: times,
    medianMs: median(times),
    maxMs: highest(times),
    passed: last.passed,
    failures: last.failures,
  };
}

async function measureMemory(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Performance.enable");
    await session.send("HeapProfiler.collectGarbage");
    await session.send("HeapProfiler.collectGarbage");
    const { metrics } = await session.send("Performance.getMetrics");
    const read = (name) => metrics.find((metric) => metric.name === name)?.value ?? null;
    return { jsHeapUsedSize: read("JSHeapUsedSize"), nodes: read("Nodes") };
  } finally {
    await session.detach().catch(() => {});
  }
}

function renderTable(rows) {
  const headers = ["Budget", "Target", "Measured", "Result"];
  const cells = rows.map((row) => [row.budget, row.target, row.measured, row.status.toUpperCase()]);
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...cells.map((cell) => cell[i].length)),
  );
  const line = (parts) => parts.map((part, i) => part.padEnd(widths[i])).join("  ").trimEnd();
  const rule = widths.map((width) => "─".repeat(width)).join("──");
  return [line(headers), rule, ...cells.map(line)].join("\n");
}

const server = await startServer({ mode: "prod" });
const browser = await launchBrowser();
const chromium = browser.version();
const results = { scroll: {}, memory: {} };
try {
  for (const theme of ["builtin.tactical", "neutral"]) {
    const page = await openScenario(browser, server.url, `theme=${theme}&servers=${ROWS}`, VIEWPORT);
    try {
      results.scroll[theme] = await measureScroll(page, SCROLL_SEED[theme]);
      results.memory[theme] = await measureMemory(page);
    } finally {
      await page.context().close();
    }
  }

  const activationPage = await openScenario(browser, server.url, `theme=builtin.tactical&servers=${ROWS}`, VIEWPORT);
  try {
    results.activation = await measureActivation(activationPage);
  } finally {
    await activationPage.context().close();
  }

  const visibilityPage = await openScenario(
    browser,
    server.url,
    `theme=builtin.tactical&servers=${ROWS}&select=3`,
    VIEWPORT,
  );
  try {
    results.visibility = await measureVisibility(visibilityPage);
  } finally {
    await visibilityPage.context().close();
  }
} finally {
  await browser.close();
  await server.stop();
}

const scrollTactical = results.scroll["builtin.tactical"];
const scrollNeutral = results.scroll.neutral;
const memoryRatio = results.memory["builtin.tactical"].jsHeapUsedSize / results.memory.neutral.jsHeapUsedSize;

const budgets = [
  {
    id: "scroll",
    budget: "Server list scroll",
    target: `≥ ${BUDGETS.fps} fps`,
    measured: `${round(scrollTactical.meanFps)} fps`,
    pass: scrollTactical.meanFps >= BUDGETS.fps,
  },
  {
    id: "activation",
    budget: "Theme activation → first paint",
    target: `≤ ${BUDGETS.activationMs} ms`,
    measured: `${round(results.activation.medianMs)} ms median`,
    pass: results.activation.medianMs <= BUDGETS.activationMs,
  },
  {
    id: "visibility",
    budget: "Visibility check",
    target: `≤ ${BUDGETS.visibilityMs} ms`,
    measured: `${round(results.visibility.medianMs, 2)} ms median`,
    pass: results.visibility.medianMs <= BUDGETS.visibilityMs,
  },
  {
    id: "memory",
    budget: "Memory vs Neutral",
    target: `≤ ${BUDGETS.memoryRatio.toFixed(2)}× heap`,
    measured: `${round(memoryRatio, 3)}×`,
    pass: memoryRatio <= BUDGETS.memoryRatio,
  },
];

const failed = budgets.filter((budget) => !budget.pass);
const report = {
  chromium,
  mode: "prod",
  viewport: VIEWPORT,
  rows: ROWS,
  headless: true,
  note: "Headless Chromium numbers are indicative, not the WebKitGTK build the launcher ships.",
  budgets: Object.fromEntries(
    budgets.map((budget) => [
      budget.id,
      { target: budget.target, measured: budget.measured, pass: budget.pass },
    ]),
  ),
  scroll: results.scroll,
  activation: results.activation,
  visibility: results.visibility,
  memory: { ...results.memory, ratio: memoryRatio },
  passed: failed.length === 0,
};

await mkdir(OUT, { recursive: true });
const reportPath = path.join(OUT, "perf.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Chromium ${chromium}  ·  ${VIEWPORT.width}×${VIEWPORT.height} @${VIEWPORT.scale}×  ·  prod build  ·  ${ROWS} rows`);
console.log(`Headless Chromium numbers are indicative, not the WebKitGTK build.\n`);
console.log(
  renderTable(
    budgets.map((budget) => ({
      budget: budget.budget,
      target: budget.target,
      measured: budget.measured,
      status: budget.pass ? "pass" : "fail",
    })),
  ),
);
console.log("\nDetails");
const scrollLine = (label, stats) =>
  `  ${label.padEnd(20)} ${round(stats.meanFps)} fps mean · p95 ${round(stats.p95FrameMs)} ms · max ${round(
    stats.maxFrameMs,
  )} ms · ${stats.framesOver33ms}/${stats.frames} frames > 33 ms`;
console.log(scrollLine("scroll tactical", scrollTactical));
console.log(scrollLine("scroll neutral", scrollNeutral));
console.log(`  activation           ${results.activation.runs.map((ms) => round(ms)).join(", ")} ms · max ${round(results.activation.maxMs)} ms`);
console.log(
  `  visibility (${results.visibility.source})  ${round(results.visibility.medianMs, 2)} ms median · max ${round(
    results.visibility.maxMs,
    2,
  )} ms${results.visibility.failures === undefined ? "" : ` · ${results.visibility.failures} failures, passed=${results.visibility.passed}`}`,
);
console.log(
  `  memory               tactical heap ${results.memory["builtin.tactical"].jsHeapUsedSize} B / ${results.memory["builtin.tactical"].nodes} nodes · neutral heap ${results.memory.neutral.jsHeapUsedSize} B / ${results.memory.neutral.nodes} nodes`,
);
console.log(`\nReport: ${path.relative(ROOT, reportPath)}`);

if (failed.length > 0) {
  console.log(`\n${failed.length} budget(s) missed: ${failed.map((budget) => budget.id).join(", ")}`);
  if (!alwaysOk) process.exitCode = 1;
}
