# UI harness

Renders the real `App` in a headless browser against a faked Tauri backend
(`@tauri-apps/api/mocks` + fixtures), so any view or menu can be screenshotted
without the desktop window. Theme packages load straight from
`src-tauri/resources/builtin-themes/`, so edits there show up on the next shot.

One-time setup (downloads a headless Chromium into `~/.cache/ms-playwright`):

    npx -y playwright install chromium-headless-shell

Shoot a scenario (starts Vite on port 1431 if it isn't running):

    tools/harness/shoot.sh <out.png> "<query>" [css-width] [css-height]

Defaults: 1154×744 CSS px at 1.25 device scale, i.e. a 1442×930 window at the
launcher's default interface scale. Browser console output lands next to the
PNG as `<out>.log`; uncaught errors are also painted onto the page.

| Query | Effect |
|---|---|
| `theme=<id>` | Built-in theme to activate (default `builtin.tactical`; `neutral` for none) |
| `scheme=dark\|light` | Mode the store renders in, before the first paint (default: whatever the store persisted, i.e. dark) |
| `servers=<n>` | Fixture server count (default 120) |
| `view=favourites\|recent\|mods` | Click that nav tab |
| `select=<index>` | Select that server |
| `selectMod=<index>` | Open that mod (by visible-list index) once it's loaded |
| `settings=1` | Open Settings |
| `settingsTab=<id>` | Click the Settings tab matching that `data-tab` id or label text (with `settings=1`) |
| `popup=map\|tags\|region` | Open that filter dropdown |
| `modal=serverInfo\|modFilter\|update` | Open that modal (`serverInfo` uses the selected server, or server 0) |
| `click=<css selector>` | Click an element; repeatable, run in order |
| `dayz=1` | Report DayZ as running |

Example: `tools/harness/shoot.sh /tmp/detail.png "select=3&popup=map" 1540 860`

## Driver

`driver.mjs` is the scriptable form of the same page, for the visual and perf
harnesses (plain ESM, Node ≥ 20). It launches the cached headless shell
(`HARNESS_BROWSER` overrides, newest `chromium_headless_shell-*` otherwise) with
scrollbars left visible, as `shoot.sh` does.

```js
import { launchBrowser, openScenario, startServer } from "./driver.mjs";

const server = await startServer({ mode: "prod" }); // or "dev", the default
const browser = await launchBrowser();
try {
  const page = await openScenario(browser, server.url, "theme=neutral&scheme=light", {
    width: 1400, height: 800, scale: 1, scheme: "light",
  });
  await page.screenshot({ path: "/tmp/shot.png" });
} finally {
  await browser.close();
  await server.stop();
}
```

- `startServer({ mode, port })` → `{ url, port, mode, buildMs?, log, stop() }`.
  `dev` reuses a Vite already on the port (leaving it running, as `shoot.sh`
  does) and otherwise spawns `npx vite`; `prod` builds the harness entry with
  the repo's own Vite config into `tools/harness/.out/prod`, copies
  `src-tauri/resources/builtin-themes/` beside it — that absolute path is what
  `main.tsx` fetches themes from — and serves it with `vite preview`. Default
  ports: 1431 dev, 1432 prod (`HARNESS_PORT` overrides); logs land in
  `tools/harness/.out/`. `stop()` ends the server, and in prod mode removes the
  scratch build with it (regenerable in a couple of seconds, and `eslint .`
  walks it while it is on disk).
- `launchBrowser()` → a Playwright `Browser`. `headless: false` is deliberate:
  Playwright would otherwise pass `--hide-scrollbars` and the shots would lose
  the themed scrollbars.
- `openScenario(browser, baseUrl, query, { width = 1400, height = 800, scale = 1, scheme })`
  → a `Page` on `<baseUrl>?<query>`, once `body[data-harness-ready]` is set and
  `document.fonts.ready` has settled. Console errors are echoed to stderr; a
  page error fails the call, and any that lands later is kept in
  `page.harnessErrors`.
- `window.__harness.activate(id)` switches the active theme through the store's
  own activation path (what the Themes page calls) and resolves two animation
  frames after the repaint, so the perf harness can time apply-to-first-paint.
  `window.__harness.visibilityCheck()` runs the fallback visibility check over
  every registry element with a non-empty `required`, for the same harness.
  `modal=` is the one query that needs `dev`: the rest of `__harness` comes from
  `App.tsx`, which only exposes it under `import.meta.env.DEV`.

`npm run harness:smoke` exercises the driver end to end: prod build, then
`theme=neutral` and `theme=builtin.tactical&scheme=light`, each asserting
`[data-el="list.servers"]` renders.

## Perf

`npm run perf` measures the SPEC §24 budgets in a prod harness build at
1400×800: servers-list scroll at 27,000 rows (Tactical and Neutral), theme
activation apply-to-first-paint, the fallback visibility check, and the
Tactical-vs-Neutral JS heap. It prints a pass/fail table, writes
`tools/harness/.out/perf.json`, and exits 1 when a budget misses — pass
`--no-fail` to exit 0 anyway (a harness error, before any numbers, still
fails).

Chromium here is the headless shell, not the WebKitGTK build the launcher
ships, so the numbers are indicative rather than release figures.

The activation scenario loads `theme=builtin.tactical` and resets to neutral
between runs: the fixture only reports the page's own theme as installed, so a
`theme=neutral` load has no package for `activate("builtin.tactical")` to
apply. Memory and scroll each use their own page per theme, so the heap is read
with the list already rendered.

