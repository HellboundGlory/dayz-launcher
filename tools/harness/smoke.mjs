// Smoke test for the harness driver: prod build, two scenarios, one required element.
// Run with `npm run harness:smoke`.
import { launchBrowser, openScenario, startServer } from "./driver.mjs";

// Neutral renders the base components, which carry `data-tetra-el` hooks; a
// theme package renders the element pipeline, which carries `data-el`.
const SCENARIOS = [
  { query: "theme=neutral", marker: '[data-tetra-el="name"]' },
  { query: "theme=builtin.tactical&scheme=light", marker: '[data-el="list.servers"]' },
];

const server = await startServer({ mode: "prod" });
const browser = await launchBrowser();
try {
  for (const { query, marker } of SCENARIOS) {
    const page = await openScenario(browser, server.url, query);
    const found = await page.locator(marker).count();
    if (found === 0) throw new Error(`${query}: ${marker} not found at ${server.url}`);
    console.log(`ok  ${query}  ${found}× ${marker}`);
    await page.context().close();
  }
} finally {
  await browser.close();
  await server.stop();
}
console.log(`harness smoke passed (${server.mode} build ${server.buildMs} ms)`);
