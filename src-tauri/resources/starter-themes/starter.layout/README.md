# Custom layout

A copy of the built-in **Tactical** theme: top tabs, a filter bar, a column
table for the server list with the selected server's detail panel beside it,
a mods view, its modals and the Settings screen. Every file is kept as the
launcher ships it, so it is a complete, working layout you can rearrange —
copy this folder and change what you want, the rest keeps working.

## Files

- **`theme.json`** — the manifest. `capabilities` names what the folder ships
  (`tokens`, `css`, `layout`, `settings`); a capability declared without its
  files, or files without the capability, fails the import.
- **`tokens.json`** — the palette: dark and light schemes plus bloom, scales
  and roles. A colour token reaches CSS as a custom property of the same name
  (`--bg`, `--surface`, `--accent`).
- **`styles.css`** — the stylesheet, keyed by `[data-el="..."]` for elements
  and `[data-region="..."]` for regions. Sizes, gaps and borders live here.
- **`settings.schema.json`** — this theme's own Settings fields. Each one
  reaches CSS as `--setting-<id>` on the window root.
- **`layout/`** — where everything is placed:
  - **`shell.json`** — the window frame: the header with the nav tabs, the
    `r-main` region a view renders into, and the footer.
  - **`settings.json`** — the Settings screen.
  - **`views/browser.json`** — the filter bar above a row holding the server
    list and `r-detail`.
  - **`views/mods.json`** — the mods view.
  - **`lists/*.json`** — one per list: `servers`, `mods`, `serverMods`,
    `modServers`, `modFilterResults`. Each holds its row template; `servers`
    and `mods` also declare the `columns` their table draws.
  - **`modals/*.json`** — `serverInfo`, `modFilter` and `update`.

`shell.json` and `views/browser.json` carry a `variants` list, one entry per
window width (`minWidth`), so a change to one belongs in every variant.
Element and surface ids come from the launcher's element list; an id the
launcher does not know fails the import.

## First edits to try

1. **Widen the detail panel.** In `styles.css`, `[data-region="r-detail"]`
   sets the panel's width — change it and the table beside it reflows.
2. **Reorder the server list.** In `layout/lists/servers.json`, move an entry
   in `columns`; the header and every row follow that order.
3. **Move an element.** In `layout/views/browser.json`, move an
   `{ "element": "..." }` node into another region's `children`, in each
   variant, and it renders there instead.

## Docs

- Theme guide: <https://tetralauncher.com/docs/themes/>
- Element list: <https://tetralauncher.com/docs/themes/elements>
