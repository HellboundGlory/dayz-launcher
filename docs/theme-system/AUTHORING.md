# Theme system v2: authoring guide

A worked path through building a Tetra Launcher theme, from a palette to a full custom layout. It doesn't repeat what `SPEC.md` and `ELEMENTS.md` already say precisely; it shows how the pieces fit together with real examples drawn from the three starters that ship with the launcher.

- **The contract:** `SPEC.md`.
- **Every element, surface, list and modal:** `ELEMENTS.md`.
- **Vocabulary:** `CONTEXT.md`.

## 1. Start here

Three starter packages ship with the launcher, under a themes-folder copy the launcher offers from theme management. Each is a complete, working theme on its own — copy the one closest to what you want to build and edit from there. They form a ladder: each one adds exactly one v2 capability over the last.

| Starter | Adds over the last | Capabilities | Files |
|---|---|---|---|
| **Colours only** (`starter.colours`) | — | `tokens` | `theme.json`, `tokens.json`, `README.md` |
| **Styled** (`starter.styled`) | a stylesheet and theme settings | `tokens`, `css`, `settings` | adds `styles.css`, `settings.schema.json` |
| **Custom layout** (`starter.layout`) | a rearranged shell, browser view, server list and server info modal | `tokens`, `css`, `layout`, `settings` | adds `layout/shell.json`, `layout/views/browser.json`, `layout/lists/servers.json`, `layout/modals/serverInfo.json` |

Pick by what you're changing, not by ambition:

- **Only want a different palette?** Copy Colours only. Nothing else to touch.
- **Want to restyle individual elements, or let users tune a couple of values?** Copy Styled.
- **Want the window arranged differently** — a detail panel on the other side, a merged column, window controls on the left — **copy Custom layout.**

Every starter's own `README.md` explains its files in more depth than this guide does; read it once you've copied the folder. This guide is the map between the three, and the reference for the parts none of them shows in full (the complete CSS API, every settings field type, the limits table).

## 2. The package

A theme is a folder named after its `id`, containing at most the files SPEC §3.1 lists:

```
<theme-id>/
  theme.json                  manifest (required)
  tokens.json                 colours, scales and roles
  styles.css                  theme CSS
  settings.schema.json        theme settings
  README.md                   author's notes
  layout/
    shell.json
    settings.json
    views/browser.json
    views/mods.json
    modals/serverInfo.json
    modals/modFilter.json
    modals/update.json
    lists/servers.json
    lists/mods.json
    lists/modFilterResults.json
    lists/serverMods.json
    lists/modServers.json
    popups/<popup-id>.json
  fonts/<name>.<woff2|woff|ttf|otf>
  images/<name>.<png|webp|jpg|jpeg|svg>
  previews/<name>.<png|webp|jpg|jpeg>
```

`theme.json` is the only required file. Every other file, including every layout file, is optional — a missing layout file just means the launcher falls back to Neutral's version of that one screen.

### 2.1 The manifest fields that matter to an author

| Field | Rules |
|---|---|
| `schemaVersion` | Always `2` |
| `themeApi` | `"2.x"`; the launcher accepts major `2` |
| `id` | `[a-z0-9][a-z0-9._-]{2,63}`, and must match the folder name |
| `name` | 1–48 characters |
| `author` | 1–48 characters |
| `version` | Semver |
| `minimumLauncherVersion` | Semver; import is refused if it's newer than the launcher |
| `description` | Up to 280 characters |
| `capabilities` | See below |
| `previews` | Up to 5, each `{ "file": "previews/…", "caption": "…" }`, captions up to 80 characters |
| `license`, `homepage`, `tags` | Optional; `homepage` must be `https:`, `tags` up to 8 entries of 24 characters each |

An id starting `builtin.` is refused at import — that prefix is reserved for bundled themes.

### 2.2 Capabilities must match what you ship

```json
{ "capabilities": ["tokens", "css", "settings"] }
```

| Capability | Covered by |
|---|---|
| `tokens` | `tokens.json` |
| `css` | `styles.css` |
| `fonts` | `fonts/` |
| `images` | `images/` |
| `layout` | `layout/` |
| `settings` | `settings.schema.json` |

Declaring a capability without shipping the file it covers, or shipping the file without declaring the capability, is an import error — this is checked exactly, file for file, not just "does the theme feel styled". Add or drop a capability only together with the file it covers.

The theme grid derives one label from what you've declared: **Custom layout** if you have `layout`, otherwise **Styled** if you have `css` or `fonts`, otherwise **Colours**.

## 3. Tokens by example

`tokens.json` holds your palette, plus optional scales and roles. Every key is optional; anything you leave out keeps Neutral's value, so you can change one thing at a time.

```json
{
  "schemaVersion": 2,
  "colors": {
    "dark":  { "bg": "#0e1016", "surface": "#151824", "accent": "#7c9cff", "text": "#e5e9f5" },
    "light": { "bg": "#f2f3fa", "surface": "#ffffff", "accent": "#3a4fbf", "text": "#171a2b" }
  },
  "scales": {
    "radius": { "md": "8px" }
  },
  "roles": {
    "color": { "onAccent": "#0e1016" }
  }
}
```

- `colors.dark` and `colors.light` each want the same twelve tokens (`bg`, `surface`, `surface2`, `border`, `text`, `muted`, `muted2`, `accent`, `accent2`, `success`, `warn`, `danger`), as `#rrggbb` strings. The launcher derives hover states, soft fills and lines (`row-hover`, `accent-soft`, `border-weak`, and the rest) from these automatically.
- A `scales` entry redefines one step of a named scale — here, `radius.md` moves from its default 6px to 8px. Anything else in that scale keeps its default.
- A `roles` entry points a role at either a scale step name (`"md"`) or a literal value (`"8px"`).

**The one thing to get right: `colors` is per-scheme, `roles.color` is not.** `colors.dark.accent` and `colors.light.accent` can be two different colours, because dark and light are separate objects. `roles.color.onAccent`, by contrast, is a single value that applies in both schemes at once — there is no `roles.color.dark` or `roles.color.light`. If you pick an `onAccent` that only reads well against your dark-mode `accent`, it will also be used against your light-mode `accent`, and may fail contrast there. Check `onAccent`, `onAccent2` and `onDanger` against both scheme's accent and danger colours before shipping, not just one.

Dev Mode's live contrast check (§7) runs in whichever scheme is currently active, so switch schemes while checking rather than trusting a single pass.

**What users can retune.** The customiser in Settings (SPEC §4.6) edits the twelve colours, the dark/light switch and bloom, plus a short list of roles: `radius.window`, `radius.panel`, `radius.row`, `radius.control`, and the two `type.family` steps — the UI and data font stacks. Everything else stays as your `tokens.json` ships it. When the active theme is a user theme (`local.*`, one this launcher created), **Save changes** writes the edits into it in place and **Save as new** duplicates it under the field's name. A bundled or imported theme can't be written in place, so the single primary action there reads **Save theme** and creates a new user theme.

## 4. The CSS API by example

`styles.css` is one file, capped at 256 KB, wrapped by the launcher in `@layer launcher, theme, guarantees;` so your rules win over the launcher's defaults without a specificity fight — you never need `!important`, and it's refused if you use it.

Everything below is checked by the CSS validator (`src-tauri/src/theme/validator/css.rs`) at import and on every hot reload; a snippet that isn't accepted there fails with a `CSS-0x` rule id, named in SPEC §14.3.

### 4.1 Selectors

```css
/* An element, by its stable id */
[data-el="server.join"] { border-radius: var(--t-radius-control); }

/* A part inside an element */
[data-el="server.players"] [data-part="caption"] { color: var(--muted); }

/* A state, combined with the element */
[data-el="server.join"][data-state~="busy"] { opacity: 0.6; }

/* Scoped to a context — only the selected-server copy of the name */
[data-context="selection"] [data-el="server.name"] { color: var(--accent); }

/* A list, a row and a column */
[data-list="servers"] [data-row][data-state~="selected"] [data-column="players"] {
  color: var(--accent);
}

/* A class your own layout file declared */
.t-detail-rail { border-inline-start: 1px solid var(--border); }

/* Interaction and structure */
[data-el="filter.reset"]:hover,
[data-el="filter.reset"]:focus-visible { color: var(--accent); }
[data-el="server.tags"] [data-part="chip"]:first-child { margin-inline-start: 0; }
[data-el="server.join"]:not([data-state~="disabled"]) { cursor: pointer; }

/* Generated content — only an empty string is allowed */
[data-el="server.readiness"] [data-part="dot"]::before { content: ""; }
```

- **Allowed attribute selectors:** `[data-el]`, `[data-part]`, `[data-state]`, `[data-context]`, `[data-list]`, `[data-row]`, `[data-column]`. Nothing else — `[href]`, `[title]`, `[class]` and so on are all refused (`CSS-01`).
- **Allowed pseudo-classes:** `:hover`, `:focus-visible`, `:active`, `:disabled`, `:checked`, `:first-child`, `:last-child`, plus the structural functions `:not()`, `:is()`, `:where()` and `:nth-child()`. Anything else, including `:focus` (use `:focus-visible`) and `::placeholder`, is refused.
- **Allowed pseudo-elements:** `::before` and `::after`, plus the scrollbar and slider pseudo-elements `::-webkit-scrollbar`, `::-webkit-scrollbar-thumb`, `::-webkit-scrollbar-track`, `::-webkit-scrollbar-corner`, `::-webkit-slider-thumb` and `::-webkit-slider-runnable-track`, bare or scoped by an allowed selector.
- **Refused outright:** a bare type selector (`div`), an id selector (`#foo`), the universal selector (`*`), and any class that isn't your own `t-[a-z0-9-]+` class declared on one of your layout nodes — a class must exist in the layout before CSS can target it, or import fails with `CSS-02`. A malformed `t-` class (uppercase, an underscore, or just `t-`) fails with `CSS-03`.

### 4.2 Cascade layers, properties and values

```css
[data-el="server.join"] { z-index: 5; }        /* refused: CSS-04, launcher owns stacking */
[data-el="server.join"] { color: red !important; }  /* refused: CSS-01 */
@import url("other.css");                       /* refused: CSS-06 */
[data-el="box"] { background: url("https://example.com/x.png"); }  /* refused: CSS-07 */
[data-el="box"] { background: url("data:image/png;base64,AAAA"); } /* refused: CSS-07 */
```

Every CSS property is allowed except `z-index` (the launcher owns stacking, SPEC §5.13) and `content` with anything but `""`. Values may not contain a remote or scheme-relative `url()`, a `data:` URI, `@import`, `expression(`, `-moz-binding`, `behavior:`, `javascript:` or `vbscript:`, and a `url()` may only name a file inside your own package (served over `tetra-theme://`) — a path with `..` in it is refused the same way a remote one is.

At-rules are limited to three:

```css
@media (min-width: 900px) and (prefers-reduced-motion: reduce) { … }
@media (prefers-color-scheme: dark) { … }
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@font-face {
  font-family: "MyFont";
  src: url("fonts/myfont.woff2");
}
```

`@media` accepts only `width`/`min-width`/`max-width`, `prefers-reduced-motion` and `prefers-color-scheme`; anything else (`@supports`, `@container`, `@layer`, `min-height`, and so on) is refused. `@font-face`'s `src` must point inside `fonts/` in your own package.

### 4.3 Reaching tokens and settings

Colours keep today's variable names (`--bg`, `--accent`, `--row-selected`, …); everything else added by v2 is prefixed `--t-` (`--t-radius-row`, `--t-space-6`, `--t-type-body-size`, `--t-shadow-modal`), and the two font families are `--t-type-family-ui` and `--t-type-family-data`. The old bare names — `--font-ui`, `--font-data`, `--space-*`, `--radius-*` — are gone; the launcher publishes none of them, so `font-family: var(--t-type-family-ui)` is the only way in. A theme setting reaches CSS only as a generated `--setting-<id>` custom property on the window root — never substituted into the stylesheet text itself:

```css
[data-el="server.name"] {
  padding-inline-start: calc(var(--setting-rowSpacing, 4) * 1px);
}
```

## 5. Layout by example

Layout is what the `layout` capability unlocks. Each screen is one file (SPEC §5.1, §2.1); a file that fails validation, or fails the visibility check, falls back to Neutral's version of just that screen — the rest of your theme, including tokens and CSS, stays in effect.

Every file has an envelope:

```json
{ "schemaVersion": 2, "root": { "type": "stack", "direction": "column", "children": [] } }
```

A container (`stack`, `grid`, `box`, `scroll`, `tabs`, `accordion`) holds `children`; a leaf places an `element`, a `surface`, `text`, an `image`, or (shell only) an `outlet`. `id`, `class`, sizing, `padding`/`gap`, `position` and `hidden` are common to every node — the full list is SPEC §5.5.

### 5.1 Width variants

A file carries either a single `root` or a `variants` array, never both. A variant is a whole alternative root for a range of window widths:

```json
{
  "schemaVersion": 2,
  "variants": [
    { "minWidth": 0,   "root": { … } },
    { "minWidth": 900, "root": { … } }
  ]
}
```

- Two to four variants, ordered by ascending `minWidth`, the first `0`. The launcher renders the last entry whose `minWidth` is at or below the window's CSS width, so the first covers everything narrower than the second.
- Width is the window's CSS width, which the interface scale divides: the 975×620 minimum window is 650px wide at the 1.5× maximum scale. 650×413 is therefore the narrowest the launcher ever renders, and every variant is validated there (SPEC §5.2) — a required element has to stay visible at that size, however you rearrange it.
- The shell, view files, `layout/settings.json`, modals and popups all take `variants`. A list template does not: `layout/lists/<id>.json` has a `row` and `columns`, and `root` or `variants` there fails with `LAY-01`; a list adapts through its columns, `wrap` and `overflowX` instead.
- Region ids may repeat across variants — only one root renders at a time, so `r-detail` can name the panel in both, and only a repeat *inside* one root is `LAY-08`. Required elements must still be *placed* in every variant (`REQ-06`), so keep them in all of them.
- Switching a variant re-runs the visibility check (§7).

Tactical is the worked example. Its `layout/shell.json` has two variants (0 and 900) that keep the same regions — `r-shell`, `r-header`, `r-main`, `r-footer` — and differ only in density: below 900 the logo, the nav items and the Steam state fall back to icons and a dot, and from 900 they carry labels. Its `layout/views/browser.json` is a genuine rearrangement: below 1400 the filter bar stacks into two rows (`r-filterbar-top` wraps, `r-filterbar-bottom` sits beneath it) and the detail panel gains an `r-detail-body` wrapper, while at 1400 the bar is one row again. Both browser variants reuse the same ids (`r-browser`, `r-filterbar`, `r-hides`, `r-detail`, `r-identity`, `r-title`, `r-stats`, `r-props`, `r-actions`, `r-join`).

**The widths to design for.** 650×413 is the narrowest, as above. 975×620 is the minimum window at 1× scale and 1400×800 the default window at 1× — the two sizes the screenshot and perf harnesses use. ~1154×744 is the harness's default viewport, a 1442×930 window at the launcher's default 1.25× interface scale, so it is the middle case most of the example shots are taken at. Dev Mode's switcher (§7) offers 650, 975 and 1400 along with whatever widths your files declare.

### 5.2 The tab-order rule

**Tab order is DOM order — the order your layout file declares, top to bottom, child by child.** There is no `tabindex` a theme can set; the only way to change what gets focused first is to change where a node sits in the file. This is the one structural mistake you can make without seeing it happen, because it only shows up when a keyboard-only user tries to move through the screen.

`starter.layout`'s `layout/shell.json` puts the window controls before the drag region and the nav rail:

```json
{
  "type": "stack", "direction": "row", "align": "center", "landmark": "banner",
  "children": [
    { "surface": "surface.windowControls" },
    { "element": "app.dragRegion", "grow": 1 },
    { "surface": "surface.navRail" }
  ]
}
```

Tabbing from outside the window lands on Minimize first, then Maximize, then Close, then into the nav rail — because that's the order they're written here, not because window controls are conventionally first. Neutral puts the nav rail before the window controls, so Neutral's tab order starts in navigation instead. Whichever order you choose, it's worth actually tabbing through the screen once (§7) rather than assuming it reads the way it looks.

### 5.3 A worked composition: the browser view

`starter.layout`'s `layout/views/browser.json` moves the detail panel to the *left* of the list — a rearrangement, not a restyle:

```json
{
  "schemaVersion": 2,
  "root": {
    "type": "stack", "direction": "column", "height": "100%", "grow": 1,
    "children": [
      { "surface": "surface.filterBar" },
      {
        "type": "stack", "direction": "row", "grow": 1,
        "children": [
          {
            "type": "stack", "id": "r-detail", "context": "selection", "direction": "column",
            "children": [
              { "element": "server.name" },
              { "element": "server.tags" },
              { "type": "stack", "direction": "row",
                "children": [ { "element": "server.players" }, { "element": "server.ping" } ] },
              { "element": "list.serverMods" },
              { "type": "stack", "direction": "row",
                "children": [ { "element": "server.join" }, { "element": "server.actionNotice" } ] }
            ]
          },
          { "element": "list.servers", "grow": 1 }
        ]
      }
    ]
  }
}
```

Two things to notice, both enforced at import:

- **Every element id must exist in the registry.** `src/theme/registry.json` is the source of truth; `ELEMENTS.md` is its readable form. Placing `{"element": "server.joins"}` (a typo) or an id the registry doesn't know fails with `ELE-01`.
- **The detail panel is a `context: "selection"` container.** Inside it, `server.*` elements resolve to the selected server, exactly as they would in a row — but a `selection` container can't be nested inside a row, because the two subjects would contradict each other.
- **`server.actionNotice` is placed explicitly, right after `server.join`.** It's required in every context that places `server.join` (`with join` in `ELEMENTS.md`'s Req column); leave it out and the launcher auto-places it for you, but placing it yourself is how you control where it lands.

Its list row (`layout/lists/servers.json`) shows the other half — merging what were two columns (map, ping) into one `"Map / Ping"` column by stacking two elements inside a single `column`:

```json
{
  "type": "stack", "direction": "column", "column": "location",
  "children": [ { "element": "server.map" }, { "element": "server.ping" } ]
}
```

`column` is only legal on a direct child of a row's root, and only when the file declares `columns` — here `location` must be one of the ids in that file's `columns` array (SPEC §7.5).

### 5.4 What every layout file must keep

Whatever you rearrange, the composition-level required-element rules in `ELEMENTS.md` still apply: window controls, the drag region, navigation to every view and Settings, both required notices, and — inside any context that places `server.join` — `server.actionNotice`. The validator checks presence anywhere in the composition, not in a fixed slot, so moving `surface.windowControls` into a view file instead of the shell is fine as long as it's there in every composition that needs it.

## 6. Theme settings

`settings.schema.json` declares fields shown under your theme's own section of Settings. Four field types:

```json
{
  "schemaVersion": 2,
  "fields": [
    { "id": "rowSpacing", "type": "number", "label": "Row name indent", "min": 0, "max": 16, "step": 1, "default": 4 },
    { "id": "compactRows", "type": "boolean", "label": "Compact server rows", "default": false },
    { "id": "accentStyle", "type": "choice", "label": "Accent style",
      "options": [ { "value": "solid", "label": "Solid" }, { "value": "soft", "label": "Soft" } ],
      "default": "solid" },
    { "id": "highlight", "type": "color", "label": "Highlight", "default": "#8fa3bd" }
  ]
}
```

- `number` needs `min`, `max` and `default`, and takes an optional `step`.
- `boolean` needs only `default`.
- `choice` needs at least two `options`, each `value` matching `[a-z0-9-]+`, plus `default`.
- `color` takes a `#rrggbb` `default`.
- Every `id` matches `[a-z][a-zA-Z0-9]{0,31}` and is unique; `label` is at most 40 characters.

**Where a value reaches, once saved:**

- **Tokens and layout**, as `{{id}}` substitution: a string that's exactly one placeholder takes the value's own type (so a `number` field can drive a numeric token); a placeholder inside a longer string is plain text.
- **CSS**, only as `--setting-<id>` on the window root — never substituted into the stylesheet text, so a setting can't smuggle a selector past validation (ADR-0022).
- **Layout structure**, through `hidden`: a `boolean` or `choice` field can drive whether a node renders at all:

```json
{ "hidden": { "setting": "compactRows", "equals": true } }
```

Use `"not"` in place of `"equals"` to invert the condition. Validation expands every combination of your `boolean` and `choice` fields (capped at 64) and checks the required-element rules against each one — so a settings combination that would hide a required element fails import, not just at runtime.

## 7. Checking your work

Dev Mode is session-only, toggled from theme management, and runs against your theme as you edit it.

- **Outlines** on every region and element, with their ids and contexts, so you can see what you're actually looking at.
- **Click-to-pin inspector:** click an outlined region or element to pin its floating panel open. It doesn't open on hover alone.
- **A validation panel** for the active theme, listing errors and warnings with their rule id (`CSS-01`, `ELE-03`, and so on), the file, and a pointer to the exact node — the same pointer format SPEC §14.4 defines — and a "Fell back to Neutral" list naming every file that fell back and the element and reason that failed it.
- **Contrast warnings** for the active token set, checked against the pairs SPEC §18 lists (`text`/`bg`, `text`/`surface`, `muted`/`surface`, `onAccent`/`accent`, `onAccent2`/`accent2`, `onDanger`/`danger`, and each semantic colour against `surface`). Below 4.5:1 warns; below 3:1 on body text is an import error (`TOK-05`).
- **A variant and settings switcher**, for seeing each breakpoint variant and settings combination without resizing the window or re-tuning fields by hand.
- **Hot reload**, on the existing file watch: an invalid file keeps showing its last valid version while you fix it, rather than flashing to the default layout.
- **Copy selector**, which emits a stable-API selector for whatever's under the pointer — a fast way to get the right `[data-el="…"]` into your stylesheet.

**The variant switcher.** The Variant row offers chips for 650, 975 and 1400 plus every `minWidth` your layout files declare, and a **Real width** chip that goes back to the live window. Picking a width renders every screen at it at once and re-runs the visibility check, so that width's fallbacks show immediately. The row is inert when no file declares `variants` ("No variants declared"), and reads "No screen renders from a layout file yet" when nothing in the active theme is rendering from layout at all — neither message means your theme is wrong. The Settings row switches between your theme's own values and each combination of your `boolean` and `choice` fields, capped at 64, without editing the schema.

**The visibility check.** It runs at theme activation, hot reload, a debounced window resize, opening a view, modal or popup, switching variant, collapsing or expanding a region, changing tab, and opening an accordion section — never on data updates. For every required element in the current composition it proves the element exists, has a non-zero box, lies inside the window, isn't hidden by `display: none`, `visibility: hidden` or zero opacity, isn't covered at its centre, and — if it's interactive — is keyboard-focusable.

A few situations are worth knowing before you rely on them:

- **Only the selected and focused row of a list is measured.** Revealing a per-row action on hover stays legal, because the check only looks where the user is; a row scrolled out of the window isn't measured at all.
- **Scrolling counts as reaching.** An element scrolled out of a scrolling pane passes as long as the pane itself is visible, because the user can scroll to it.
- **The selection panel's Join covers the selected row's.** Joining the selected server always works, so a visible `server.join` inside a `selection` container satisfies the selected row's Join; a focused-but-unselected row still needs its own on screen.
- **Notices are measured only while they show.** A required notice that renders nothing, or that the user dismissed, is skipped.
- **Closed UI is deferred, not failed.** A required element inside a closed accordion section, an inactive tab or a collapsed subtree is measured once that part opens. While a modal is open only its own requirements are measured; while Settings is an overlay or panel the view beneath it is skipped — but the window controls and the drag region are still measured, because they must never be buried. Keep a Settings overlay off the header, as Tactical does by scoping its overlay to `r-main`, leaving `r-header`'s window controls and drag region clear.

When a required element fails, **the file it belongs to falls back** to Neutral's version of that screen, and only that file (§16.1). Two places tell you why: a dismissible **FALLBACK** notice in the window, shown once per theme per launcher version, and, with Dev Mode on, the validation panel's "Fell back to Neutral" list, naming each file and the element and reason behind it.

## 8. Limits

An author will hit these directly; they're not soft guidance.

| Limit | Value |
|---|---|
| Files per package | 64 |
| Uncompressed size | 8 MB |
| Path depth | 3 segments |
| Image dimensions | 4096 × 4096 |
| `styles.css` | 256 KB |
| Nodes per layout file | 2,000 |
| Node depth | 24 |
| Text node | 120 characters |
| Free label | 40 characters |
| Column label | 24 characters |
| Variants per file | 4 |
| Settings combinations | 64 |
| Previews | 5 |
| Theme classes per file | 200 |

A layout file with more nodes than the limit, or nested deeper than 24 levels, fails import (`LIM-01`, `LIM-02`) rather than silently truncating — split a very large screen across more containers rather than one deep tree, and prefer surfaces over reassembling their contents by hand where you don't need to change the arrangement.
