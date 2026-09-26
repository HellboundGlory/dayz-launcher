# Styled

Builds on a palette with a stylesheet and a settings panel. Copy this folder
as the start of a theme that wants to reach into individual elements with CSS
and let the user tune a few values themselves.

## Files

- **`theme.json`** — the manifest. `capabilities` lists `tokens`, `css` and
  `settings`, matching the three content files below; add or remove a
  capability only together with the file it covers, or import fails (MAN-07/
  MAN-08).
- **`tokens.json`** — the palette, exactly as in the Colours only starter:
  `colors.dark` and `colors.light`, twelve tokens each.
- **`styles.css`** — element-level styling. Selectors may only be
  `[data-el="..."]` (an element's stable id, listed at
  <https://tetralauncher.com/docs/themes/elements>),
  optionally combined with `[data-state="..."]` or `[data-context="..."]`, or
  a `t-`-prefixed class a layout file has declared. Reach the palette and
  scales through the CSS variables already on the window root (`--accent`,
  `--t-radius-md`, …); this file's own settings arrive the same way, as
  `--setting-<id>`.
- **`settings.schema.json`** — the fields shown under this theme's own
  section of Settings. Each field needs a unique `id`, a `type`
  (`number`/`boolean`/`choice`/`color`) and a `default`; a `number` also
  needs `min`/`max`, a `choice` needs at least two `options`. A saved value
  substitutes `{{id}}` in `tokens.json`, reaches CSS as `--setting-<id>`, and
  can drive a layout node's `hidden` — never CSS text directly.

## Adding fonts

This starter ships no `fonts/` folder, since a real font file and its
licence are more than a starter should vendor. To add one: create
`fonts/<name>.woff2` (or `.woff`/`.ttf`/`.otf`), add `"fonts"` to
`capabilities`, and reference it from `styles.css` with `@font-face` — the
`src: url(...)` must point at a file inside this package.
