# Theme system v2 specification

The design contract for Tetra Launcher's theme system v2: what a theme package contains, what it may change, and what the launcher guarantees no matter what a theme does.

- **Status:** designed, not implemented. Nothing here is on `main`.
- **Vocabulary:** `CONTEXT.md`.
- **Decisions and their reasoning:** `docs/adr/0003`–`0024`.
- **Every element a theme can place:** `ELEMENTS.md`.
- **Build order and worker packages:** `IMPLEMENTATION.md`.
- **Q numbers** refer to the design session of 2026-09-15, traced in §27.

## 1. Goals and definition of done

### 1.1 Goals

1. A theme composes the whole window, so navigation, filters, lists and detail panels can go anywhere (ADR-0005).
2. Any single element can be placed on its own, and ready-made surfaces stay available for simple themes (ADR-0006).
3. The launcher stays usable under any theme that passes validation: joining, navigating, closing the window and escaping a bad theme all keep working (ADR-0008, ADR-0011, ADR-0024).
4. Themes survive launcher updates, because they target a stable styling API and a versioned element registry (ADR-0007, ADR-0015).
5. A mistake in one screen costs that screen, not the whole theme (ADR-0012).

### 1.2 Definition of done

v2 is done when all of the following hold:

1. **Neutral is pixel-identical** to today's interface, proven by the visual regression harness (§25) and one manual pass on the real WebKitGTK build.
2. **Tactical v2 reproduces `docs/theme-system/reference/tactical-reference.png`** as a theme package only, with no Tactical-specific launcher code: navigation as top tabs, a column-header table, a persistent detail panel with per-mod readiness, the hide toggles, square corners, and a compact per-row Join.
3. **Every required-element rule** in §14 and §15 is enforced, and the fallback path in §16 is covered by tests.
4. **The performance budgets** in §24 are met.
5. **The v1 format and its code are deleted** (ADR-0003), and no v1 package can be imported.
6. **The docs match the build:** this file, `ELEMENTS.md`, `CONTEXT.md`, `AUTHORING.md` and `DESIGN.md`.

Two extra showcase themes are explicitly out of scope until the above ships (§26).

## 2. Scope

### 2.1 Themeable screens

| Screen | Layout file | Notes |
|---|---|---|
| Shell | `layout/shell.json` | The window frame, with the `view` and `modals` outlets |
| Server browser | `layout/views/browser.json` | One file for the Servers, Favourites and Recent scopes (ADR-0005) |
| Mods | `layout/views/mods.json` | |
| Settings | `layout/settings.json` | Presented as a view, an overlay or a panel (§9.4) |
| Server info modal | `layout/modals/serverInfo.json` | |
| Mod filter modal | `layout/modals/modFilter.json` | |
| Update modal | `layout/modals/update.json` | |
| Lists | `layout/lists/<list>.json` | Row templates and columns (§7) |
| Popups | `layout/popups/<id>.json` | One per launcher popup (§9.6) |

A missing file means the launcher uses Neutral's version of that screen.

### 2.2 Launcher-owned screens

Steam required, first-run setup, the Activation Safety Window and the splash are never laid out or styled by a theme (ADR-0008).

- Steam required and first-run setup render inside the main window and take the active theme's **colour and type tokens** only.
- The Activation Safety Window and the splash use fixed Neutral colours, because they must render correctly when a theme is broken or not yet loaded.

### 2.3 Launcher-owned blocks

Inside otherwise themeable screens, two things stay launcher-owned (ADR-0024). A theme places them whole and cannot reach inside them:

- `settings.themeManagement`, the way out of a bad theme;
- every destructive confirmation: delete theme, unsubscribe, clean up removed mods, and unsubscribe a server's unique mods.

### 2.4 What a theme never controls

Behaviour, in every sense: filtering, sorting, discovery, joining, mod management, Steam integration, settings persistence, focus handling and keyboard shortcuts. A theme also never changes the words on a required element (ADR-0014), the stacking order of page, popups and modals, the window's minimum size, or the resize edges.

## 3. The theme package

### 3.1 Files

```
<theme-id>/
  theme.json                  manifest (required)
  tokens.json                 colours, scales and roles
  styles.css                  theme CSS
  settings.schema.json        theme settings
  README.md                   author's notes (starters ship one)
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

- Only `theme.json` is required; every other file is optional.
- A file outside this list, or an extension outside §22's allowlist, is refused at import.
- Paths are at most 3 segments deep, matching today's archive rule.
- `settings.values.json` is the launcher's own sidecar, written next to the package. Themes never ship it and export skips it.

### 3.2 `theme.json`

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | number | Always `2` |
| `themeApi` | string | `"2.x"`; the major must be 2 |
| `id` | string | `[a-z0-9][a-z0-9._-]{2,63}`, and also the folder name |
| `name` | string | 1–48 characters |
| `author` | string | 1–48 characters |
| `version` | string | Semver |
| `minimumLauncherVersion` | string | Semver |
| `description` | string | Up to 280 characters |
| `capabilities` | string[] | From §3.3 |
| `previews` | object[] | Up to 5, each `{ "file": "previews/…", "caption": "…" }` with captions up to 80 characters |
| `license` | string or null | |
| `homepage` | string or null | `https:` only |
| `tags` | string[] | Up to 8, each up to 24 characters |

- **Reserved ids:** anything starting `builtin.` is refused at import, so a user package can never shadow a bundled one.
- **`previews`** replaces v1's single `preview` field. The first preview is the grid card's image.

### 3.3 Capabilities

Capabilities replace tiers (ADR-0004). Each one is checked against the files actually shipped; declaring one without the file, or shipping the file without declaring it, is an import error.

| Capability | Covered by |
|---|---|
| `tokens` | `tokens.json` |
| `css` | `styles.css` |
| `fonts` | `fonts/` |
| `images` | `images/` |
| `layout` | `layout/` |
| `settings` | `settings.schema.json` |

The grid derives one label: **Custom layout** with `layout`, otherwise **Styled** with `css` or `fonts`, otherwise **Colours**.

### 3.4 Versions and compatibility

- **`themeApi`:** the launcher accepts major 2. A minor above the launcher's own is accepted with a Dev Mode warning, since minors are additive.
- **`minimumLauncherVersion`:** import refuses a package that needs a newer launcher. The validator also computes the true minimum from the elements and options used, and warns when the manifest understates it.
- **Element renames** keep the old id as an alias for all of 2.x (ADR-0012).

### 3.5 On disk

Packages live in the themes folder under the launcher's data directory, one folder per id, exactly as today; imports stage into `.staging/` first. Neutral is not on disk at all: it is compiled into the launcher (ADR-0019).

## 4. Tokens

### 4.1 `tokens.json`

```json
{
  "schemaVersion": 2,
  "colors": { "dark": { … }, "light": { … } },
  "bloom": 0.9,
  "scales": { "radius": { … }, "space": { … }, "type": { … },
              "border": { … }, "shadow": { … }, "motion": { … } },
  "roles":  { "radius": { … }, "space": { … }, "type": { … },
              "color": { … }, "border": { … }, "shadow": { … }, "motion": { … } }
}
```

Every key is optional; anything a theme leaves out keeps Neutral's value. A role may hold either a scale step name (`"md"`) or a literal value (`"7px"`), which is how today's odd sizes survive unchanged.

### 4.2 Colours

Twelve colours per scheme, exactly as today, with the launcher deriving the soft and line variants from them:

| Token | Dark default | Group |
|---|---|---|
| `bg` | `#0d0f13` | Surfaces |
| `surface` | `#12151b` | Surfaces |
| `surface2` | `#1a1e26` | Surfaces |
| `border` | `#262b34` | Surfaces |
| `text` | `#e7ebf0` | Text |
| `muted` | `#7a8494` | Text |
| `muted2` | `#98a2b2` | Text |
| `accent` | `#8fa3bd` | Accents |
| `accent2` | `#b0976a` | Accents |
| `success` | `#4d9a75` | Semantic |
| `warn` | `#c19a55` | Semantic |
| `danger` | `#b3564d` | Semantic |

Derived automatically, unchanged from today: `border-weak`, `muted-soft`, `accent-soft`, `accent-line`, `accent2-soft`, `accent2-line`, `success-soft`, `success-line`, `warn-soft`, `warn-line`, `danger-soft`, `danger-line`, `row-hover`, `row-selected` and `glow`.

### 4.3 Scales

Defaults reproduce today's values.

| Scale | Steps |
|---|---|
| `radius` | `none` 0, `xs` 2px, `sm` 4px, `md` 6px, `lg` 8px, `full` 9999px |
| `space` | `0`–`48` in 2px steps, named by their pixel value (`space.6` is 6px) |
| `type.size` | `3xs` 7px, `2xs` 8px, `xs` 9px, `sm` 10px, `md` 11px, `lg` 12px, `xl` 13px, `2xl` 14px, `3xl` 22px |
| `type.weight` | `normal` 400, `medium` 500, `semibold` 600, `bold` 700, `extrabold` 800 |
| `type.tracking` | `none` 0, `tight` -0.025em, `wide` 0.025em, `wider` 0.05em, `widest` 0.1em |
| `type.leading` | `none` 1, `tight` 1.25, `snug` 1.375, `normal` 1.5, `relaxed` 1.625 |
| `type.family` | `ui`, `data` |
| `border` | `none` 0, `hairline` 1px, `thick` 2px |
| `shadow` | `none`, `sm` `0 8px 24px rgba(0,0,0,0.4)`, `md` `0 10px 28px rgba(0,0,0,0.5)`, `lg` `0 12px 40px rgba(0,0,0,0.5)`, `xl` `0 24px 60px rgba(0,0,0,0.6)`, `glow` (today's `--glow`) |
| `motion.duration` | `fast` 150ms, `normal` 200ms, `slow` 300ms |
| `motion.easing` | `standard` `cubic-bezier(0.4, 0, 0.2, 1)`, `linear` |

The base interface uses 11 distinct corner radii and 15 distinct text sizes today. The scales carry the common ones; the rest live as literals on the roles below, so nothing has to shift by a pixel.

### 4.4 Roles

Roles are what the base interface actually reads (ADR-0016). A theme that changes `radius.row` restyles every row without touching CSS.

| Family | Roles |
|---|---|
| `radius` | `window`, `panel`, `card`, `modal`, `popup`, `row`, `control`, `input`, `chip`, `badge`, `thumb`, `track`, `pill` |
| `space` | `windowPad`, `panelPad`, `modalPad`, `popupPad`, `rowX`, `rowY`, `controlX`, `controlY`, `chipX`, `chipY`, `stackGap`, `inlineGap`, `sectionGap`, `listGap` |
| `type` | `display`, `heading`, `subheading`, `body`, `label`, `caption`, `micro`, `button`, `chip`, `data`, `rowName`, `rowMeta`, `statValue`, `statCaption`, `compactSubheading` (11.5px), `compactTitle` (12.5px) (each holds family, size, weight, tracking and leading) |
| `color` | `onAccent`, `onAccent2`, `onDanger`, `focusRing`, `scrim`, `rowHover`, `rowSelected` |
| `border` | `hairline`, `control`, `focus` |
| `shadow` | `panel`, `modal`, `popup`, `drawer`, `glow`, `inspector` (`0 8px 24px rgba(0,0,0,0.5)`) |
| `motion` | `hover`, `expand`, `overlay` |

**The default rule:** every role's default equals the value the base interface uses today at the call sites listed in `docs/theme-system/TOKEN-MAP.md`, which the tokens stage produces. Where two call sites mapped to one role differ today, the role splits into `<role>` and a named variant (for example `radius.control` and `radius.controlSmall`), and the map and this table are updated in the same commit. No call site is left holding a hardcoded value.

### 4.5 CSS variables

- **Colours keep today's variable names** (`--bg`, `--accent`, `--row-selected`…), so `tailwind.config.js` and the existing palette spine keep working.
- **Everything else is new and prefixed `--t-`:** `--t-radius-row`, `--t-space-rowX`, `--t-type-body-size`, `--t-shadow-modal`, `--t-motion-hover`, and so on. Scale steps are exposed too (`--t-radius-md`, `--t-space-6`), so theme CSS can reach them.
- Variables are written to the window root when a theme is applied, exactly as the palette is today.

### 4.6 The token customiser

The customiser in Settings (part of `settings.themeManagement`) edits the twelve colours, the dark and light switch, and bloom, as today. Under v2 it also edits a short list of roles: `radius.window`, `radius.panel`, `radius.row`, `radius.control`, and the `ui` and `data` font families (Q76). Everything else lives in `tokens.json`. Saving works as it does today: the edited values are written to the active theme when it is a user theme, and otherwise saved as a new user theme.

## 5. Layout files

### 5.1 One file per screen

Each screen is one file (§2.1), and the file is the unit of fallback: a file that fails validation is replaced by Neutral's version of that screen, and the rest of the theme stays in effect (ADR-0012).

### 5.2 File envelope

```json
{
  "schemaVersion": 2,
  "root": { "type": "stack", "direction": "column", "children": [] }
}
```

A file that needs different arrangements at different widths uses `variants` instead of `root`:

```json
{
  "schemaVersion": 2,
  "variants": [
    { "minWidth": 0,   "root": { … } },
    { "minWidth": 900, "root": { … } }
  ]
}
```

- Two to four variants, ordered by ascending `minWidth`, the first being `0`.
- Width is the window's CSS width, which shrinks as the interface scale rises: at the 975px minimum window and 1.5× scale it is 650px. Every variant is validated, and the narrowest is validated at 650×413.
- A variant switch re-runs the visibility check (§15).

### 5.3 Containers

Every container takes `children`, plus the common props in §5.5.

| Type | Props |
|---|---|
| `stack` | `direction: row / column`, `align`, `justify`, `wrap: true / false`, `gap` |
| `grid` | `columns`, `rows` (track lists), or `areas` (a rectangular array of area names) with `area` on children; `gap`, `columnGap`, `rowGap`, `alignItems`, `justifyItems` |
| `box` | A plain wrapper: no layout of its own |
| `scroll` | `axis: y / x (y)`. The only way to get a scrolling area |
| `tabs` | §5.11 |
| `accordion` | §5.12 |

- `align` and `justify` take `start`, `center`, `end`, `stretch`, `baseline` (align only), `spaceBetween` and `spaceAround` (justify only).
- Track lists hold lengths, `fr` values, `auto`, `min-content` and `max-content`.
- A list element owns its own scrolling, so it may not be placed inside a `scroll` container (ADR-0018).

### 5.4 Leaves

| Leaf | Shape |
|---|---|
| Element | `{ "element": "server.join", "options": { … }, "class": "t-join" }` |
| Surface | `{ "surface": "surface.filterBar" }` |
| Text | `{ "type": "text", "value": "REQUIRED MODS", "role": "heading / label / caption / body" }` |
| Image | `{ "type": "image", "src": "images/logo.png", "fit": "contain" }` or `{ "type": "image", "icon": "globe" }` |
| Outlet | `{ "type": "outlet", "name": "view" }` or `"modals"`, in the shell only |

- **Text** is plain, at most 120 characters, with no markup, links or data (ADR-0014). `role` picks the type role it reads and its heading semantics.
- **Image** is always decorative: it renders as `<img alt="">` and is hidden from screen readers. `src` must be a package image; `icon` must be a launcher icon name (§6.5). `fit` is `cover` or `contain`.
- **Outlets** appear exactly once each, in `layout/shell.json`. The `view` outlet holds the current view; the `modals` outlet is where modals and popups render.

### 5.5 Common props

Every node accepts:

| Prop | Meaning |
|---|---|
| `id` | A region id, `r-[a-z0-9-]+`, unique within the theme. Needed only when something references the node |
| `class` | One or more class names, each matching `t-[a-z0-9-]+` (ADR-0015) |
| `padding`, `paddingX`, `paddingY`, `paddingTop` … | A space token or role. Never a raw length, and there are no margins |
| `gap` | A space token or role (containers only) |
| `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | §5.6 |
| `grow`, `shrink`, `basis` | Flex behaviour inside a `stack` |
| `area` | Grid area name, inside a `grid` with `areas` |
| `position` | §5.7 |
| `hidden` | §5.8 |
| `landmark` | §5.9 |
| `context` | `selection`, `modSelection` or `modFilterPreview`, with an optional `empty` subtree (§8.1) |
| `collapsible`, `resizable` | §5.10 |
| `column` | Which column this node occupies, inside a row template only (§7.5) |

Anything else is an import error, so a typo can't be silently ignored.

### 5.6 Sizing

Lengths are `<n>px`, `<n>%`, `auto`, `min-content`, `max-content`, or a space token (`space.24`). Track lists also take `<n>fr`. Percentages resolve against the parent, as in CSS.

Sizes are advisory for required elements: the visibility check (§15) fails a layout that sizes one to nothing.

### 5.7 Position

```json
{ "position": { "anchor": "topRight", "x": "8px", "y": "8px" } }
```

- Anchors: `topLeft`, `top`, `topRight`, `left`, `center`, `right`, `bottomLeft`, `bottom`, `bottomRight`.
- The node is positioned against its parent, which the launcher makes a containing block.
- Offsets move the node inward from the anchor.
- Stacking follows declaration order; there is no `z-index` (§5.13).

### 5.8 Hiding a node

`hidden` takes:

- `true`, hiding the node always;
- `{ "setting": "compactRows", "equals": true }`, or `"not"` instead of `"equals"`, driven by a boolean or choice theme setting (§13).

Validation checks every settings combination, so a required element can't be hidden by any combination a user can pick (§14.2).

### 5.9 Landmarks

`landmark` marks a container as a page region for assistive technology: `navigation`, `main`, `complementary`, `banner` or `contentinfo`.

- The launcher supplies the accessible name; a theme can't word it.
- At most one `main`, `banner`, `contentinfo` and `navigation` per composition. `complementary` may repeat.
- Inside a `navigation` landmark, nav items rove with the arrow keys and Home/End (§8.4).

### 5.10 Collapsible and resizable regions

```json
{
  "type": "stack", "id": "r-rail",
  "collapsible": { "default": "expanded", "collapsed": { "type": "stack", "children": [] } },
  "resizable": { "edge": "right", "min": "160px", "max": "420px" },
  "children": []
}
```

- **Collapsible:** the `collapsed` subtree replaces `children` while collapsed, and is validated like a variant. A required element inside the region must appear in both subtrees: it may shrink, never disappear. `app.collapseToggle` with `region: "r-rail"` drives it, and the container carries the `collapsed` state for CSS.
- **Resizable:** the launcher draws the handle on the named edge, with `min` and `max` respected. The handle is focusable; the arrow keys move it in 8px steps and Home and End jump to the limits.
- Collapsed state and sizes persist per theme (§13.3).

### 5.11 Tabs

```json
{
  "type": "tabs", "id": "r-detail",
  "tabs": [
    { "id": "info",  "label": { "type": "text", "value": "INFO", "role": "label" }, "content": { … } },
    { "id": "mods",  "label": { … }, "content": { … } }
  ]
}
```

- The launcher owns the active tab, the ARIA tablist semantics, the arrow keys and Home and End, and persists the active tab per theme.
- The theme composes each label and each pane.
- Required elements must sit in the first tab, which is the default pane (ADR-0011).
- Tab ids match `[a-z0-9-]+` and are unique within their container.

### 5.12 Accordion

```json
{
  "type": "accordion", "id": "r-settings", "mode": "single", "initial": "none",
  "sections": [
    { "id": "game", "header": { … }, "body": { … } }
  ]
}
```

- `mode` is `single` (opening one closes the others) or `multiple`. `initial` is `none` or `first`.
- The launcher wraps each `header` in a button carrying `aria-expanded` and `aria-controls`, moves between headers with the arrow keys and Home and End, and persists which sections are open per theme.
- Sections carry the `open` state for CSS.
- Required elements may sit in a closed section. Validation still proves they are placed, and the visibility check measures them once their section opens (ADR-0011).
- Neutral's Settings is one accordion with `mode: "single"`, `initial: "none"` and the three sections Game, Launcher and Theme, which is today's behaviour.

### 5.13 Stacking

The launcher owns the layers: the page, then popups, then modals, then popups opened inside modals. Within one layer, later siblings paint over earlier ones, exactly as the file declares them. Themes never set `z-index`, in layout or in CSS.

### 5.14 A minimal shell

```json
{
  "schemaVersion": 2,
  "root": {
    "type": "stack", "direction": "column", "height": "100%",
    "children": [
      { "type": "stack", "direction": "row", "landmark": "banner", "padding": "space.8", "gap": "space.8",
        "children": [
          { "element": "app.logo" },
          { "surface": "surface.navRail" },
          { "element": "app.dragRegion", "grow": 1 },
          { "surface": "surface.windowControls" }
        ] },
      { "element": "notice.storage" },
      { "element": "notice.error" },
      { "type": "box", "landmark": "main", "grow": 1, "children": [ { "type": "outlet", "name": "view" } ] },
      { "type": "stack", "direction": "row", "landmark": "contentinfo", "gap": "space.8",
        "children": [ { "element": "status.steam" } ] },
      { "type": "outlet", "name": "modals" }
    ]
  }
}
```

This passes validation: window controls, a drag region, navigation to every view and Settings (inside `surface.navRail`), Steam status, and both required notices.

## 6. Elements

### 6.1 The registry

One file, `src/theme/registry.json`, is the source of truth for both sides: the frontend imports it, and the backend compiles it in (ADR-0007). `ELEMENTS.md` is its readable form, and a test fails the build when the two disagree.

```json
{
  "registryVersion": "2.0",
  "elements": {
    "server.join": {
      "kind": "action",
      "subject": "server",
      "where": ["server"],
      "required": ["list:servers/row", "modal:serverInfo"],
      "multiplicity": "perContext",
      "options": {
        "wording": { "type": "enum", "values": ["join", "fixAndJoin"], "default": "join" },
        "display": { "type": "enum", "values": ["iconLabel", "label", "icon"], "default": "iconLabel" },
        "icon":    { "type": "icon", "default": "play" }
      },
      "freeLabel": false,
      "parts":  ["icon", "label", "spinner"],
      "states": ["busy", "disabled", "playing", "modded", "needsMods"],
      "since": "2.0",
      "aliases": [],
      "fallbackPlacement": { "list:servers/row": "append", "modal:serverInfo": "append" }
    }
  },
  "surfaces": { … }, "lists": { … }, "modals": { … },
  "popups": { … }, "blocks": { … }, "icons": [ … ]
}
```

| Field | Meaning |
|---|---|
| `kind` | `display`, `input`, `action`, `nav`, `notice`, `list` or `block` |
| `subject` | `server`, `mod`, `serverMod`, `modServer`, `workshopMod`, or absent for elements with no subject |
| `where` | Placement codes (`ELEMENTS.md`, "Where codes") |
| `required` | Where the element must appear, as `view:browser`, `view:mods`, `settings`, `modal:<id>`, `popup:<id>`, `list:<list>/row`, `views`, `views+settings`, or `withJoin` |
| `multiplicity` | `many`, `perComposition` or `perContext` |
| `options` | Typed options: `enum`, `boolean`, `icon`, `text`, `length`, `token` or `region` |
| `freeLabel` | Whether the `label` option is accepted; always `false` for required elements |
| `since`, `aliases` | Version introduced, and previous ids still accepted |
| `fallbackPlacement` | Where the launcher auto-places it when a launcher update makes it required (§6.8) |

### 6.2 Placement and contexts

The validator walks each layout file and tracks the subject available at every node:

- inside a row template, the subject is that list's row subject;
- inside `layout/modals/serverInfo.json`, it is the modal's server;
- inside a container with `"context": "selection"`, it is the selected server; `modSelection` gives the selected mod, and `modFilterPreview` the previewed Workshop mod;
- inside a popup, it is whatever the trigger had.

Placing an element whose `subject` doesn't match the available subject is an import error, as is placing one outside its `where` codes. Contexts don't nest: a `selection` container inside a row is an error, because the two subjects would contradict each other.

### 6.3 Multiplicity

Counted per composition (§5, and `ELEMENTS.md` "Compositions and multiplicity"):

- `many`: unlimited.
- `perComposition`: once. Two copies of `filter.search` in one view is an error.
- `perContext`: once per subject context, so the row, the modal and each panel may each carry one.

A surface counts as one placement of every element inside it, so `surface.filterBar` plus a separate `filter.search` is an error.

### 6.4 Options, labels and wording

- Options are validated against the registry at import: unknown names, wrong types and values outside an enum are all errors.
- `label` is accepted only where `freeLabel` is true, holds plain text of at most 40 characters, and becomes both the visible and the accessible name.
- Required elements take `wording` variants instead, and the launcher picks the words for the current state (ADR-0014). The only variant in 2.0 is `server.join`'s `join` and `fixAndJoin`.
- Launcher wording is never a template a theme can fill: no placeholders, no concatenation.

### 6.5 Icons

The `icon` option takes one of:

- **a launcher icon name**, from the set the interface already uses (`lucide-react`):
  `alertTriangle`, `appWindow`, `arrowRight`, `ban`, `check`, `checkCircle`, `chevronDown`, `chevronLeft`, `chevronRight`, `chevronsLeft`, `chevronsRight`, `clock`, `copy`, `download`, `externalLink`, `fileArchive`, `fileOutput`, `folder`, `folderOpen`, `gamepad`, `globe`, `inbox`, `info`, `listTree`, `loader`, `minus`, `moon`, `moreHorizontal`, `package`, `palette`, `play`, `plus`, `refresh`, `rotateCcw`, `search`, `settings`, `square`, `star`, `sun`, `thumbsUp`, `trash`, `upload`, `users`, `x`;
- **a package image**, `images/<name>.svg|png|webp`, rendered as a decorative `<img alt="">`, so it can't run scripts;
- **`"none"`**, allowed only when the element still renders a label.

Icon size and colour come from CSS; the launcher sets neither.

### 6.6 Parts and states

Each element root carries:

| Attribute | Value |
|---|---|
| `data-el` | The element id |
| `data-state` | Space-separated state names from the registry |
| `data-context` | `row`, `selection`, `modal`, `modSelection`, `modFilterPreview` or `popup` |

Named pieces inside carry `data-part` (ADR-0015), and a part may carry its own `data-state`, which is how `server.tags` marks each chip. Parts and states are part of the compatibility contract: they may be added in a 2.x minor, and removing one needs a major.

### 6.7 Surfaces

A surface is a launcher-composed group placed whole (ADR-0006). Its arrangement is fixed; its insides keep their ids, parts and states, so CSS still reaches them. A theme that wants different insides composes from elements instead. `ELEMENTS.md` lists every surface and its contents.

### 6.8 Renames, removals and auto-placement

- **Renamed:** the old id stays as an alias for all of 2.x, and Dev Mode warns.
- **Removed and optional:** dropped with a Dev Mode warning; the screen still renders (ADR-0012).
- **Newly required, or a required element replaced:** the launcher places it at its `fallbackPlacement` rather than failing the screen, and Dev Mode warns. The forms are `append` (end of the screen or row root), `afterElement:<id>`, and `anchor:<anchor>` (positioned in the screen root).

## 7. Lists

One model covers every list (ADR-0018). `ELEMENTS.md` lists each list's subject, sort keys, row states and default text.

### 7.1 A list file

```json
{
  "schemaVersion": 2,
  "columns": [
    { "id": "name",    "label": "SERVER", "width": "1fr",  "align": "start", "sort": "name" },
    { "id": "players", "width": "72px", "align": "end", "sort": "players" },
    { "id": "actions", "width": "auto", "align": "end" }
  ],
  "row": {
    "type": "grid",
    "children": [
      { "element": "server.name",    "column": "name" },
      { "element": "server.players", "column": "players" },
      { "element": "server.join",    "column": "actions" }
    ]
  },
  "empty": { "type": "text", "value": "Nothing here", "role": "body" }
}
```

`columns` and `row` are both optional; a file may restyle rows without declaring columns, in which case the row root lays its children out itself.

### 7.2 Columns

| Field | Rules |
|---|---|
| `id` | `[a-z0-9-]+`, unique in the file |
| `label` | Theme text, up to 24 characters. Only for a column with no `sort`: a sortable column takes the launcher's wording for its key (ADR-0014) |
| `width` | A length, `<n>fr` or `auto` |
| `minWidth`, `maxWidth` | Lengths |
| `align` | `start`, `center` or `end` |
| `sort` | A sort key from that list's set. An unknown key is an import error |

### 7.3 The header

The launcher renders the header from `columns`, above the scroll area, with the scrollbar's width reserved so the columns line up with the rows. It is the list's `header` part, and each column heading is a `column` part carrying `data-column="<id>"`. A sortable heading is a button with `aria-sort`; clicking it sorts by that key, and clicking again reverses the direction. `header: false` hides it.

### 7.4 Sorting

Sort keys are launcher behaviour. `list.servers` uses today's store keys (`players`, `ping`, `mods`, `name`, `map`, `lastPlayed`, the last of which the sort popup doesn't offer). `list.mods` gains `status` alongside its existing `name`, `size`, `updated` and `subscribed` keys, which nothing reaches today. Sorting a list has no effect on any other list.

### 7.5 The row template

- The row template's root node **is** the row. The launcher adds no wrapper styling of its own, only `data-row`, the row's states and its click handling.
- `column` is allowed on direct children of the row root, and only when the file declares columns.
- Clicking a row selects its subject. Clicking an element inside it runs that element and never changes the selection.
- Rows are not focusable; §8.4 covers how the keyboard reaches them.

### 7.6 Virtualization and heights

`list.servers`, `list.mods` and `list.modFilterResults` are virtualized: the list owns its scroller, and a list may not sit inside a `scroll` container. Heights are measured, as today; `estimatedRowHeight` and `rowGap` only seed the measurement. `list.serverMods` and `list.modServers` render every row.

### 7.7 Empty, loading and stale

A list renders its `empty` or `loading` part with the launcher's wording (`ELEMENTS.md`). A theme may supply its own `empty` subtree in the list file, which replaces that wording. A `list.serverMods` showing an offline server's last known mods carries the `stale` state.

## 8. Contexts, selection and keyboard

### 8.1 Detail panels

A detail panel is any container carrying a `context` (ADR-0013):

```json
{ "type": "stack", "context": "selection", "id": "r-detail",
  "empty": { "type": "text", "value": "Select a server", "role": "body" },
  "children": [ { "element": "server.name" }, { "element": "list.serverMods" } ] }
```

- Any number of panels, anywhere their `where` codes allow.
- Without an `empty` subtree, a panel with nothing selected renders nothing.
- `selection` and `modSelection` panels live in view files and the shell; `modFilterPreview` only inside the mod filter modal.

### 8.2 The server selection

- Shared across the whole window; survives view switches and refreshes, but not a restart.
- Filters that hide the selected server don't clear it: panels keep showing it.
- Selecting fetches the server's mod list, states and sizes (§11.2), debounced while the selection moves.
- A `dzsa://` link selects its server, as today.

### 8.3 Mod selection and the modal preview

Mod selection follows the same rules inside the Mods view, and is separate from the checkboxes that drive bulk actions. The mod filter modal's preview is its own selection, cleared when the source tab changes.

### 8.4 Keyboard

- **Tab order is DOM order**, which is the order the layout file declares. Themes can't set `tabindex`.
- **Navigation:** inside a `navigation` landmark, the arrow keys and Home and End rove between nav items; Tab leaves the group.
- **Lists:** a list is one tab stop and renders as a grid (`role="grid"`, rows as `role="row"`, columns as `role="gridcell"`). ↑ and ↓ move the selection, Home and End jump to the ends, Tab moves into the selected row's controls, and Esc clears the selection. Enter never joins, so a stray keypress can't launch the game.
- **Popups:** opening moves focus into the popup, onto the selected option or the first item. The arrow keys move between items, Home and End jump, Esc closes, and focus returns to the trigger. Clicking outside closes.
- **Modals:** focus is trapped, Esc closes, clicking the backdrop closes, background scrolling is locked, and focus returns to whatever opened the modal. Initial focus goes to the modal's primary action, or the first focusable node when there isn't one.
- **Tabs and accordions:** §5.11 and §5.12.
- **Resize handles:** focusable, moved by the arrow keys in 8px steps, with Home and End for the limits.

## 9. Screens

### 9.1 The shell

The shell holds the `view` and `modals` outlets, and whatever a theme wants present on every screen. It is the only file that may use outlets, landmarks of type `banner` and `contentinfo`, and the window controls.

### 9.2 The server browser

One file for all three scopes (ADR-0005). The view root publishes the scope as a state: `scope-servers`, `scope-favourites` or `scope-recent`, so CSS can restyle or hide parts per scope, and `server.lastPlayed` can be limited to Recent through its own option.

### 9.3 Mods

One file holding `list.mods`, the `mods.*` controls, and any `modSelection` panel. Today's fixed slide-in inspector is gone: it becomes a panel the theme places.

### 9.4 Settings

`layout/settings.json` declares how Settings appears:

```json
{ "schemaVersion": 2,
  "presentation": { "mode": "overlay", "region": "r-main" },
  "root": { … } }
```

| Mode | Behaviour |
|---|---|
| `view` | Settings fills the `view` outlet, and `settings.back` returns to the previous view |
| `overlay` | Settings covers the named region; the rest of the window stays live, and Esc closes |
| `panel` | Settings renders inside the named region, alongside the current view |

`region` is required for `overlay` and `panel`, and must name a region in the shell. Neutral keeps today's overlay over the main column. Whatever the mode, every Settings control must be present, and the window controls and drag region must stay uncovered.

### 9.5 Modals

```json
{ "schemaVersion": 2,
  "placement": { "mode": "center" },
  "backdrop": "dim",
  "root": { … } }
```

- `mode` is `center`, `region` (with `region`) or `anchor` (with `anchor`, `x` and `y`).
- `backdrop` is `dim` or `none`. A backdrop-less modal still traps focus.
- Size comes from the root's own sizing.
- Everything else is the launcher's (ADR-0017): opening and closing, focus, Esc, outside clicks, the scroll lock and focus return.

### 9.6 Popups

```json
{ "schemaVersion": 2,
  "placement": { "mode": "anchored", "side": "bottom", "align": "start", "offset": "5px", "maxHeight": "320px" },
  "root": { … } }
```

| Mode | Behaviour |
|---|---|
| `anchored` | Positioned against its trigger. The launcher flips or shifts it to keep it on-screen |
| `region` | Rendered into the named region, such as a filter drawer |
| `inline` | Expanded in place, under its trigger |

- `side` is `top`, `bottom`, `left` or `right`; `align` is `start`, `center` or `end`.
- A filter or sort popup must contain its option list, and a `region` or `inline` popup must place `popup.close` (ADR-0011). Action menus have no required contents.
- A missing popup file means the launcher's default popup.

## 10. Notices

Notices are launcher messages about the state of the app or of an action. `ELEMENTS.md` lists them all.

- **Required on every view:** `notice.storage` and `notice.error`, because they report data loss and failures. On the Mods view, `notice.modsError`, `notice.modsCached` and `notice.modsResult` are required too, for the same reason.
- **Optional:** `notice.update` and `notice.modsOutdated`, because the update modal, Settings and the action bar offer the same things.
- **`server.actionNotice`** is required in every context that places `server.join`, and the launcher places it right after Join when a theme omits it. This is what fixes today's bug where composing the row actions silently drops the join warnings.
- **Rendering:** a notice renders only while its condition holds, so a theme can't reserve space for one and can't hide one that fires.
- **Announcements:** `notice.error` and `notice.modsError` are `role="alert"`; the others are `aria-live="polite"`. Each appears once per composition, so nothing is announced twice.
- **Dismissal:** the error, update and mods-result notices are dismissible, as today. The storage notice is not: it holds until the condition clears.

Three launcher notices are not placeable and not styleable beyond tokens: the fallback notice (§16.1), the incompatible-theme notice (§16.3) and the Activation Safety Window (§17).

## 11. Launcher features

These are behaviour, built so that v2 only has to place them. Stages 0 and 1 of `IMPLEMENTATION.md` ship them ahead of the rest.

### 11.1 The hide filters

`hide_empty`, `hide_full`, `hide_locked` and `hide_offline` already exist in the filter, its persistence and the registry's SQL; only the controls were missing. All four default to off, persist, and are cleared by Reset with every other filter.

### 11.2 Readiness and sizes

**What is fetched.** For one server: its declared mod list, each mod's Steam state, each mod's size, and whether the mod is unique to that server.

**When:**

- when the selection changes, debounced by 250 ms;
- when the server info modal opens;
- on Check mods, and when that server is refreshed.

Results are cached per server for the session. Workshop sizes are cached per item for 24 hours. While mods are downloading, live progress updates at the same 1.5 s cadence the Mods view already uses.

**Wording of `server.readiness`:**

| State | Label |
|---|---|
| `checking` | "Checking mods…" |
| `noMods` | "No mods declared" |
| `ready` | "All mods ready" |
| `needsDownload` | "{n} to download" |
| `needsUpdate` | "{n} to update" |
| `downloading` | "Downloading {done} of {total}" |
| `unchecked` | "Mods not checked" |

When more than one applies, the state is the first of `downloading`, `needsDownload`, `needsUpdate`, `unchecked`, `noMods`, `ready`. The `size` part sums everything outstanding.

**Sizes are honest (ADR-0021).** Steam reports only an item's total size, so:

- a mod that isn't installed shows its full size;
- an update shows "up to {size}";
- any total that includes an update is prefixed "up to";
- once a download starts, live progress replaces the estimate.

**Offline servers** use the last known mod list, and the list carries the `stale` state.

### 11.3 Server actions

| Action | Behaviour |
|---|---|
| Join | Today's join: verify, fix mods, launch. The `fixAndJoin` wording variant says "Fix and join" when mods need work |
| Check mods | Re-reads the server's rules and each mod's state. Queues nothing, which is what makes it different from the Mods view's Verify |
| Download mods | Subscribes to every mod the server declares: today's "Download mods" |
| Unsubscribe unique mods | Unsubscribes only the mods no other cared-about server needs, behind the launcher's confirmation showing the count and total size (ADR-0020, ADR-0024). A cared-about server is one the user has favourited or played before |
| Copy address | Copies `ip:gamePort` |
| Load to menu | Today's behaviour: verify, then start DayZ at the main menu without joining |

### 11.4 Mods sorting

The Mods list sorts by `name`, `status`, `size`, `updated` and `subscribed`. Only `status` is new; the other four already exist in the store with no control reaching them. `status` orders by severity: missing, update, downloading, not subscribed, server-side, ready.

### 11.5 Behaviour v2 depends on

Three gaps in today's interface are fixed as part of the stages that need them:

- every popup gains Esc, arrow-key navigation and focus return (§8.4);
- the update modal gains focus trapping and initial focus (§8.4);
- the join notices no longer vanish when a theme composes the row actions (§10).

## 12. The CSS API

### 12.1 The file and the layers

A theme's CSS is one file, `styles.css`, capped at 256 KB. The launcher wraps it in a cascade layer, so a theme wins without specificity fights (ADR-0015):

```css
@layer launcher, theme, guarantees;
```

| Layer | Holds |
|---|---|
| `launcher` | Tailwind and `main.css`, including every element's default look |
| `theme` | The theme's own CSS, wrapped by the launcher |
| `guarantees` | What no theme may override: the `:focus-visible` ring, the reduced-motion kill switch, and the launcher's backdrop, scroll-lock and focus-trap rules |

The guarantees layer deliberately does not force required elements to be visible. Judging that is the visibility check's job (§15), which lets a theme reveal an action on hover without the launcher fighting it.

### 12.2 Selectors

Allowed:

| Form | Example |
|---|---|
| An element | `[data-el="server.join"]` |
| A part | `[data-el="server.players"] [data-part="caption"]` |
| A state | `[data-el="server.join"][data-state~="busy"]` |
| A context | `[data-context="selection"] [data-el="server.name"]` |
| A theme class | `.t-detail-rail` |
| A list, row or column | `[data-list="servers"]`, `[data-row][data-state~="selected"]`, `[data-column="players"]` |
| Interaction | `:hover`, `:focus-visible`, `:active`, `:disabled`, `:checked` |
| Structure | `:not()`, `:is()`, `:where()`, `:first-child`, `:last-child`, `:nth-child()` |
| Generated boxes | `::before` and `::after`, with `content: ""` only |
| Combinators | Descendant, `>`, `+`, `~` |

Refused: type selectors (`div`), id selectors, class names that aren't the theme's own, any other attribute selector, and `!important`. A theme's class names must match `t-[a-z0-9-]+`, which Tailwind never generates, and must be declared on one of the theme's own layout nodes.

### 12.3 Properties and values

Every CSS property is allowed except:

- `z-index`, because the launcher owns stacking (§5.13);
- `content` with anything but `""`, so text can't be smuggled past the text rules (ADR-0014).

Values may not contain a remote `url()`, a `data:` URI, `@import`, `expression(`, `-moz-binding`, `behavior:`, `javascript:` or `vbscript:`. A `url()` may only name a file in the package, which the launcher serves over the `tetra-theme://` protocol.

### 12.4 At-rules

Allowed: `@media` (width, `prefers-reduced-motion`, `prefers-color-scheme`), `@keyframes`, and `@font-face` naming package fonts. Every other at-rule is refused.

### 12.5 Fonts

Fonts come only from `@font-face` rules pointing at files in `fonts/`. v1's `typography.customFonts` is removed. A font file must be a real font of its declared type, which the archive already checks.

### 12.6 What the launcher publishes

| Attribute | On |
|---|---|
| `data-el` | Every element root |
| `data-part` | Named pieces inside an element |
| `data-state` | Elements, rows, sections, tabs and regions |
| `data-context` | Any node inside a subject context |
| `data-list`, `data-row`, `data-column` | Lists, their rows and their columns |
| `t-…` classes | Exactly where the theme's layout put them |

These are the compatibility contract: they may grow in a 2.x minor, and removing one needs a major.

## 13. Theme settings

### 13.1 `settings.schema.json`

```json
{
  "schemaVersion": 2,
  "fields": [
    { "id": "compactRows", "type": "boolean", "label": "Compact rows", "default": false },
    { "id": "navPlacement", "type": "choice", "label": "Navigation",
      "options": [ { "value": "side", "label": "Side" }, { "value": "top", "label": "Top" } ],
      "default": "side" },
    { "id": "rowHeight", "type": "number", "label": "Row height", "min": 28, "max": 64, "step": 2, "default": 40 },
    { "id": "highlight", "type": "color", "label": "Highlight", "default": "#8fa3bd" }
  ]
}
```

- Ids match `[a-z][a-zA-Z0-9]{0,31}` and are unique. Labels are at most 40 characters.
- `number` needs `min`, `max` and `default`, with an optional `step`; `choice` needs at least two options, each with a value matching `[a-z0-9-]+`; `color` takes `#rrggbb`.
- A malformed field is dropped with a Dev Mode issue, as today, and the rest still load.

### 13.2 Where values reach

- **Tokens and layout:** `{{id}}` substitution, with today's semantics. A string that is exactly one placeholder takes the value's own type; a placeholder inside a longer string is plain text replacement; an unknown placeholder is left verbatim and fails whatever check that value feeds.
- **CSS:** only as generated `--setting-<id>` custom properties on the window root (ADR-0022). A setting value is never substituted into the stylesheet text, so it can't smuggle a selector or rule past validation.
- **Layout structure:** a `boolean` or `choice` may drive a node's `hidden` (§5.8).

### 13.3 Storage

Tuned values live in `settings.values.json` beside the package, as today, and export skips it. Layout state that a user changes by using the interface — collapsed regions, resized widths, the active tab, the open accordion sections — is stored by the launcher per theme, keyed by theme id and region id, and dropped when the theme is deleted.

### 13.4 Validation

Every combination of the `boolean` and `choice` fields is expanded and checked against the required-element rules, capped at 64 combinations (§23). `number` and `color` fields don't change structure, so they aren't expanded.

## 14. Validation

### 14.1 Where it runs

One validator, in Rust, against the registry (ADR-0023). It runs:

- at import, on the staged package, before anything reaches the themes folder;
- at seeding, on bundled packages;
- when the frontend asks for a theme, per file;
- on every hot reload.

The frontend renders only what the backend has accepted, and asks the backend again on reload. The visibility check (§15) is the one rule that runs in the frontend, because it needs the live interface.

### 14.2 Order of checks

1. **Archive safety:** paths, depth, extensions, file count, uncompressed size, image dimensions, font sanity (§22).
2. **Manifest:** fields, id, versions, reserved prefixes, capabilities against the files shipped.
3. **Tokens:** shape, known scale steps, value syntax, contrast floor (§18).
4. **CSS:** selectors, properties, values, at-rules, size (§12).
5. **Settings schema:** field shapes, ids, bounds, option lists.
6. **Each layout file:** envelope, nodes, props, elements, contexts, multiplicity, lists, structural limits.
7. **Across files:** region ids unique within the theme, every referenced region resolves, and the required-element rules per composition.
8. **Expansion:** every variant against every settings combination.

### 14.3 Rules

Each failure carries a stable id. The catalogue:

| Id range | Covers |
|---|---|
| `PKG-01`…`PKG-09` | Unknown path, bad extension, too many files, too large, too deep, oversized image, bad font, staging failure, unreadable file |
| `MAN-01`…`MAN-09` | Missing or malformed field, bad id, reserved id, bad semver, unsupported `themeApi` major, launcher too old, capability without files, files without capability, too many previews |
| `TOK-01`…`TOK-05` | Malformed tokens file, unknown scale step, bad value syntax, unknown role, contrast below the floor |
| `CSS-01`…`CSS-08` | Refused selector, undeclared `t-` class, bad class name, refused property, refused value, refused at-rule, remote or `data:` URL, file too large |
| `SET-01`…`SET-05` | Malformed schema, bad field id, missing bound, bad option list, too many combinations |
| `LAY-01`…`LAY-12` | Bad envelope, unknown node type, unknown prop, bad sizing value, bad padding or gap (not a token), bad position, bad region id, duplicate region id, unresolved region reference, bad variant list, bad tabs, bad accordion |
| `ELE-01`…`ELE-08` | Unknown element, wrong placement, wrong subject or context, multiplicity exceeded, unknown option, bad option value, free label where none is allowed, label too long |
| `LST-01`…`LST-06` | Unknown list, duplicate column id, bad width, unknown sort key, `column` outside a row template, list inside a scroll container |
| `REQ-01`…`REQ-06` | Missing required element in a view, in Settings, in a modal, in a popup, in a row template, or missing in some settings combination or variant |
| `LIM-01`…`LIM-05` | Too many nodes, too deep, text too long, too many variants, too many classes |

### 14.4 Result format

```json
{ "ruleId": "ELE-03", "severity": "error", "file": "layout/views/browser.json",
  "pointer": "/root/children/2/children/0", "message": "…", "hint": "…" }
```

Errors block an import and cause a fallback at load; warnings surface in the import preview and Dev Mode and block nothing. The pointer lets Dev Mode point at the exact node without re-deriving anything.

## 15. The visibility check

**What it proves.** For every required element in the current composition:

- it exists in the document;
- its box is larger than zero in both dimensions;
- it lies inside the window;
- it is not hidden by `display: none`, `visibility: hidden` or zero opacity;
- its centre point is not covered by another element;
- if it is interactive, it is keyboard-focusable.

**When it runs** (ADR-0011): theme activation, hot reload, window resize (debounced), opening a view, modal or popup, switching variant, collapsing or expanding a region, changing tab, and opening an accordion section. Never on data updates: a list refreshing 27,000 rows doesn't measure anything.

**What it skips:**

- inside lists, everything but the selected and the keyboard-focused row;
- notices that aren't currently showing;
- required elements inside a closed accordion section, a non-default tab or a collapsed subtree, until that part opens;
- while a modal is open, the page beneath it: only the modal's own requirements are measured;
- while Settings is an overlay or panel, the view beneath it. The window controls and drag region are still measured, because they must never be buried.

**Cost.** One read-only pass, batched, with no writes between measurements, budgeted at 16 ms (§24).

**On failure.** The screen is treated as invalid and falls back (§16), and Dev Mode names the element and the reason. Revealing an action on hover stays legal, because what the check measures is the selected and focused rows, where Join must be visible.

## 16. Fallback, updates and incompatible themes

### 16.1 A broken screen falls back on its own

When a file fails validation or the visibility check, that screen falls back to Neutral's version of it, and only that screen (ADR-0012). A broken shell falls back to Neutral's shell. The theme's tokens and CSS stay in effect, so the rest of the window still looks like the theme. The user sees one notice per theme per launcher version, dismissible, and Dev Mode shows the reason.

### 16.2 Launcher updates

- A **newly required element** is auto-placed at its `fallbackPlacement` rather than failing the screen (§6.8).
- A **renamed element** keeps its old id as an alias for all of 2.x.
- A **removed optional element** is dropped with a Dev Mode warning, and the screen still renders.
- A file that fails only because of a rule added by the update falls back, with the notice naming the rule.

### 16.3 Incompatible themes

v1 folders on disk are listed in the theme grid as "Incompatible — older theme format", with Delete as their only action (ADR-0003). If one is the active theme at startup, the launcher switches to Neutral and shows a one-time notice. Seeding replaces a bundled id whose folder is incompatible, but never a valid copy the user has edited.

### 16.4 Hot reload

While Dev Mode is hot-reloading, a file that fails keeps showing its last valid version, with the errors in the validation panel, so a typo doesn't flash the default layout. On the next launch, an invalid file falls back as usual.

## 17. The Activation Safety Window

Unchanged by v2. Switching themes opens a separate, opaque, panel-sized, always-on-top window with a 15-second countdown and Keep and Revert now; letting it run out reverts. It is launcher-owned, uses fixed Neutral colours, and must render correctly when the active theme is broken, which is why it is a separate window rather than part of the themed one.

## 18. Accessibility

- **Tab order is DOM order**, which is layout order. `AUTHORING.md` says so plainly, because it is the one structural thing an author can get wrong without seeing it.
- **Everything interactive is keyboard-reachable**, which the visibility check enforces for required elements and Dev Mode reports for the rest.
- **The focus ring** lives in the guarantees layer and can't be removed (§12.1).
- **`prefers-reduced-motion`** disables theme animations and transitions, also from the guarantees layer.
- **Contrast:** body text below 3:1 against its background is refused at import (`TOK-05`). Other contrast shortfalls are warnings in the import preview and Dev Mode. Pairs checked: `text`/`bg`, `text`/`surface`, `muted`/`surface`, `onAccent`/`accent`, `onAccent2`/`accent2`, `onDanger`/`danger`, and each semantic colour against `surface`.
- **Roles and names** are the launcher's: landmarks, tablists, grids, dialogs and live regions all come from the launcher, not the theme.
- **Images are decorative** and hidden from screen readers; an icon-only control keeps the launcher's wording as its accessible name.
- **Small windows:** every variant is validated at the narrowest CSS width the launcher allows, 650×413, which is the 975×620 minimum window at 1.5× interface scale.

## 19. Dev Mode v2

Session-only, toggled in theme management.

- **Outlines** for regions and elements, showing ids and contexts.
- **Click-to-pin inspector**, as today: a floating panel is reached by clicking to pin it, never by a hover corridor.
- **A validation panel** per screen: errors and warnings with their rule id, file and pointer, and the reason a screen fell back.
- **A switcher** for breakpoint variants and settings combinations, so an author can see each one without resizing or re-tuning.
- **Hot reload**, on today's file watch, keeping the last valid version (§16.4).
- **Copy selector**, which emits a stable-API selector for the element under the pointer.
- **Contrast warnings** for the active token set.

There is no visual layout editor, in v2 or as part of this plan (ADR-0002).

## 20. Built-in themes and starters

- **Neutral** is compiled into the launcher as a read-only package and loaded through the same pipeline as any other theme (ADR-0019). It is never copied into the themes folder, so it can't be deleted or corrupted, and it is what every fallback renders.
- **Tactical v2** is bundled and seeded as `builtin.tactical`, rebuilt from scratch for v2. It is the proof that the format can express the reference layout with no launcher code of its own.
- **Starters** are three packages a user can copy as the start of a theme, named for what they use: `Colours only`, `Styled` (tokens, CSS, fonts and settings) and `Custom layout` (a shell, a view, a list template, a detail panel and settings). Each ships a `README.md`, because JSON can't hold comments.
- **Seeding** installs a bundled package when its id isn't present, replaces a folder that is incompatible (§16.3), and never touches a valid copy the user has edited.

## 21. Import, export and seeding

**Import.** The user picks a `.zip`; the launcher stages it, validates it (§14), and shows a preview: name, author, version, description, the theme API it targets, the launcher version it needs, its capability label, its size and file count, its previews, and any warnings. The classification is one of new, update, same version or downgrade, and the confirm button words itself accordingly. Confirming installs from the staging folder; anything else cleans it up. A v1 package is refused with a message saying so (ADR-0003).

**Export.** The export dialog edits the manifest fields a package can carry — name, author, version, description, tags, license and homepage — and writes a `.zip` of the package's files. `settings.values.json` is skipped, since a user's tuned values aren't part of the theme.

## 22. Security

A theme package is data. Nothing in it ever executes.

- **Archive:** no absolute paths, no `..`, no symlinks; at most 3 path segments; the extension allowlist is `json`, `css`, `png`, `webp`, `jpg`, `jpeg`, `svg`, `woff2`, `woff`, `ttf`, `otf`, `txt`, `md`; images are sniffed for their real format and capped at 4096px per side; fonts are checked for a real header.
- **CSS:** no `@import`, no remote or `data:` URLs, no `expression(`, `-moz-binding`, `behavior:`, `javascript:` or `vbscript:`. Only files inside the package can be referenced, and only through the `tetra-theme://` protocol, which serves nothing outside that theme's folder.
- **SVG** is rendered through `<img>`, never inlined, so a script inside one cannot run.
- **Settings substitution** is plain text replacement into JSON, never an expression language, and never into CSS text (ADR-0022).
- **Ids** starting `builtin.` are reserved, so a user package can't shadow a bundled one.

## 23. Limits

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

File count and size are raised from v1's 20 files and 2 MB, which a v2 package with one layout file per screen would exceed on its own (Q66). Every other archive limit is unchanged.

## 24. Performance budgets

Measured in the harness at 1400×800, with Tactical v2 active:

| Budget | Target |
|---|---|
| Server list scrolling, ~27,000 rows | 55 fps or better |
| Theme activation, apply to first paint | 300 ms or less |
| One visibility check | 16 ms or less |
| Memory | Within 10% of Neutral |

## 25. Verification

**The harness.** Playwright drives the Vite frontend in Chromium with the Tauri IPC mocked by fixtures, and screenshots every view, modal, popup and Settings at 1400×800 and 975×620, in dark and light. Baselines are committed; `npm run visual:check` fails on any diff, and it runs in CI. Fixtures cover a populated list, an empty list, a modded server with mixed mod states, outdated and downloading mods, and a degraded-storage session.

**The manual pass.** Chromium and WebKitGTK differ slightly, so the release is also verified once by hand on the real build (Q55). GUI verification is driven by the user.

**Unit tests.** One fixture per validation rule id; the registry-versus-`ELEMENTS.md` agreement test; the list keyboard model; fallback and auto-placement; and the token map's coverage.

## 26. Out of scope

- A visual layout editor (ADR-0002).
- More than one view on screen at once (ADR-0009).
- Themes adding data, actions or behaviour of any kind.
- Separate layout files per browser scope: one file, styled by scope (ADR-0005).
- The two extra showcase themes, until v2 ships.
- Any remote source for themes: no marketplace, no fetching, no updates over the network.
- Right-to-left layouts, which the launcher doesn't support today.

## 27. Decision traceability

Every question settled in the 2026-09-15 design session, and where it lives now.

| Q | Decision | Where |
|---|---|---|
| Q1 | Docs tracked on `theme-phase4` | `IMPLEMENTATION.md`, "Branches and merges" |
| Q2 | v1 replaced outright | ADR-0003 |
| Q3 | The window is one composition tree | ADR-0005 |
| Q4 | Elements anywhere, plus surfaces | ADR-0006 |
| Q5 | Which screens are themeable | ADR-0008, §2 |
| Q6 | Join on every server entry | ADR-0010 |
| Q7 | Contexts: row, modal, selection | ADR-0013, §8.1 |
| Q8 | Launcher labels, theme text | ADR-0014 |
| Q9 | The hide filters | §11.1, Stage 0 |
| Q10 | Hardcoded styling becomes tokens | ADR-0016 |
| Q11 | A stable CSS API | ADR-0015 |
| Q12 | Text authoring plus Dev Mode | ADR-0002, §19 |
| Q13 | Definition of done | §1.2 |
| Q14 | Launcher features for the panel | §11, Stage 1 |
| Q15 | The doc set | This file, `ELEMENTS.md`, `IMPLEMENTATION.md`, `CONTEXT.md` |
| Q16 | Capabilities replace tiers | ADR-0004, §3.3 |
| Q17 | One file per screen | §5.1 |
| Q18 | The layout vocabulary | §5.3–§5.5 |
| Q19 | Views stay exclusive | ADR-0009 |
| Q20 | Themes position everything | ADR-0017, §9 |
| Q21 | One registry file | ADR-0007, §6.1 |
| Q22 | Multiplicity | §6.3 |
| Q23 | Surfaces are whole | ADR-0006, §6.7 |
| Q24 | Required elements | `ELEMENTS.md`, §14 |
| Q25 | Static check plus visibility check | ADR-0011, §15 |
| Q26 | Validation and failure behaviour | §14, §16 |
| Q27 | The list model | ADR-0018, §7 |
| Q28 | Detail panels | ADR-0013, §8.1 |
| Q29 | Selection behaviour | §8.2 |
| Q30 | Hide toggle details | §11.1, `ELEMENTS.md` |
| Q31 | The token set | §4.3, §4.4 |
| Q32 | CSS API detail | §12 |
| Q33 | Theme settings | §13, ADR-0022 |
| Q34 | Window size and variants | §5.2 |
| Q35 | Accessibility rules | §18 |
| Q36 | Dev Mode v2 | §19 |
| Q37 | Built-in themes | ADR-0019, §20 |
| Q38 | Unsubscribe unique mods only | ADR-0020, §11.3 |
| Q39 | Readiness and size data | §11.2 |
| Q40 | Popup placement and behaviour | ADR-0017, §9.6 |
| Q41 | Where Settings goes | §9.4 |
| Q42 | Modal behaviour versus looks | ADR-0017, §9.5 |
| Q43 | Notices | §10 |
| Q44 | Collapsible and resizable regions | §5.10 |
| Q45 | Tabs | §5.11 |
| Q46 | Element options | §6.4 |
| Q47 | Wording variants, not free labels | ADR-0014, §6.4 |
| Q48 | Icons | §6.5 |
| Q49 | The Mods list uses the list model | ADR-0018, §7 |
| Q50 | Manifest v2 | §3.2–§3.4 |
| Q51 | `t-` class names | §12.2 |
| Q52 | Renames and removals | §6.8 |
| Q53 | Three starters | §20 |
| Q54 | Build and merge order | `IMPLEMENTATION.md` |
| Q55 | Proving Neutral unchanged | §25 |
| Q56 | When the visibility check runs | §15 |
| Q57 | Popup layout files | §9.6 |
| Q58 | Which lists use the model | §7 |
| Q59 | Cascade layers | §12.1 |
| Q60 | Sizes as upper bounds | ADR-0021, §11.2 |
| Q61 | v1 folders on disk | §16.3 |
| Q62 | Hot reload with an invalid file | §16.4 |
| Q63 | `AUTHORING.md` | Stage 7 |
| Q64 | Performance budgets | §24 |
| Q65 | Write the doc set | This doc set |
| Q66 | 64 files, 8 MB | §23 |
| Q67 | One browser layout file | §9.2, ADR-0005 |
| Q68 | Validation runs in the backend | ADR-0023, §14.1 |
| Q69 | Theme colours on launcher-owned screens | ADR-0008, §2.2 |
| Q70 | Join required in the info modal | ADR-0010 |
| Q71 | What a popup must contain | ADR-0011, §9.6 |
| Q72 | Element parts | ADR-0015, §6.6 |
| Q73 | The accordion container | §5.12 |
| Q74 | Launcher-owned blocks | ADR-0024, §2.3 |
| Q75 | Mods sorting | ADR-0018, §11.4 |
| Q76 | The token customiser | §4.6 |
