// Smoke test for the harness driver, on the dev server (the prod build copies only builtin themes).
// Run with `npm run harness:smoke`.
import { launchBrowser, openScenario, startServer } from "./driver.mjs";

// Every theme, Neutral included, draws its list through the element pipeline.
const SCENARIOS = [
  { query: "theme=neutral", marker: '[data-el="list.servers"]' },
  { query: "theme=builtin.tactical&scheme=light", marker: '[data-el="list.servers"]' },
];

// A layout swapped for the default on a resize or in Settings is a broken theme screen.
const GUARDED_THEMES = ["neutral", "builtin.tactical"];
// A failure is confirmed on a second pass after a 150 ms debounce and two frames.
const SETTLE_MS = 600;

async function assertNoFallback(page, theme, step) {
  await page.waitForTimeout(SETTLE_MS);
  const reasons = await page.evaluate(() => window.__harness.fallbackReasons());
  const lines = Object.entries(reasons).map(([file, list]) => `  ${file}: ${list.join("; ")}`);
  if (lines.length > 0) throw new Error(`${theme} fell back ${step}:\n${lines.join("\n")}`);
}

async function guardFallbacks(browser, baseUrl, theme) {
  const page = await openScenario(browser, baseUrl, `theme=${theme}`);
  try {
    await page.setViewportSize({ width: 975, height: 620 });
    await assertNoFallback(page, theme, "after a resize to 975x620");
    await page.setViewportSize({ width: 1600, height: 900 });
    await assertNoFallback(page, theme, "after a resize to 1600x900");
    await page.locator('[data-el="nav.settings"], button:has-text("Settings")').first().click();
    await assertNoFallback(page, theme, "after opening Settings");
    await page.setViewportSize({ width: 1400, height: 800 });
    await assertNoFallback(page, theme, "after a resize with Settings open");
    console.log(`ok  fall-backs  ${theme}`);
  } finally {
    await page.context().close();
  }
}

const server = await startServer({ mode: "dev" });
const browser = await launchBrowser();
try {
  for (const { query, marker } of SCENARIOS) {
    const page = await openScenario(browser, server.url, query);
    const found = await page.locator(marker).count();
    if (found === 0) throw new Error(`${query}: ${marker} not found at ${server.url}`);
    console.log(`ok  ${query}  ${found}× ${marker}`);
    await page.context().close();
  }
  await Promise.all(GUARDED_THEMES.map((theme) => guardFallbacks(browser, server.url, theme)));
} finally {
  await browser.close();
  await server.stop();
}
console.log(`harness smoke passed (${server.mode} server)`);
