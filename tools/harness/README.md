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
| `servers=<n>` | Fixture server count (default 120) |
| `view=favourites\|recent\|mods` | Click that nav tab |
| `select=<index>` | Select that server |
| `selectMod=<index>` | Open that mod (by visible-list index) once it's loaded |
| `settings=1` | Open Settings |
| `settingsTab=<id>` | Click the Settings tab matching that `data-tab` id or label text (with `settings=1`) |
| `popup=map\|tags\|region` | Open that filter dropdown |
| `click=<css selector>` | Click an element; repeatable, run in order |
| `dayz=1` | Report DayZ as running |

Example: `tools/harness/shoot.sh /tmp/detail.png "select=3&popup=map" 1540 860`
