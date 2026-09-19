# Custom layout

Builds on a palette and a stylesheet with the fourth v2 capability: `layout`.
Copy this folder as the start of a theme that wants to rearrange the window
itself, not just restyle it.

## Files

- **`theme.json`** — the manifest. `capabilities` lists `tokens`, `css`,
  `layout` and `settings`; add or remove a capability only together with the
  files it covers, or import fails (MAN-07/MAN-08).
- **`tokens.json`**, **`styles.css`**, **`settings.schema.json`** — as in the
  Styled starter: a palette, element-level CSS keyed by `[data-el="..."]`,
  and this theme's own Settings fields, reached from CSS as `--setting-<id>`.
- **`layout/`** — the four files that place content into regions (SPEC §7):
  - **`shell.json`** — the window frame: header, footer and the `r-main`
    region every view renders into. This copy puts the window controls on
    the left and groups footer status into two clusters instead of one row.
  - **`views/browser.json`** — the server browser. This copy puts the
    selected server's detail panel on the *left* of the list instead of the
    right, and groups its fields into paired rows (players/ping, map/game
    time) instead of one long column.
  - **`lists/servers.json`** — the server list's columns and row template.
    This copy merges the map and ping columns into one "Map / Ping" column
    instead of giving each its own.
  - **`modals/serverInfo.json`** — the server info modal, opened from a row
    or the detail panel. This copy moves the close button before the name
    and mirrors the browser's paired-row grouping.

Every `element`/`surface` id placed in `layout/` must exist in
`src/theme/registry.json`; an id the registry doesn't know fails import with
rule ELE-01. `docs/theme-system/ELEMENTS.md` lists which elements each
composition, modal and list row requires, and which surfaces bundle several
elements as one placement.

## Editing the layout

Move an `{ "element": "..." }` or `{ "surface": "..." }` node between
`children` arrays to relocate it; wrap a group in a `"stack"` with
`"direction": "row"` or `"column"` to change how it's arranged. A list row's
elements need a `"column"` matching one of the list's declared `columns`
entries. Keep every element required by SPEC/ELEMENTS.md present somewhere
in the composition — the validator rejects an import that drops one.
