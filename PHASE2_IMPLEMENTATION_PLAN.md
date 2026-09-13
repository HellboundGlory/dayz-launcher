# Theme System — Phase 2 Implementation Plan

**Status: not started.** Untracked scratch doc, same status as
`THEME_SYSTEM_PROPOSAL.md` (never meant to be committed; delete once
Phase 2 fully lands, per the precedent Phase 1 set). Branch: TBD — cut a
new branch off `main` once `theme-system` is merged, don't build Phase 2 on
top of an unmerged Phase 1.

This turns `THEME_SYSTEM_PROPOSAL.md` §15's **"Phase 2 — Advanced tier"**
into concrete work packages, the same way `PHASE1_IMPLEMENTATION_PLAN.md`
did for Phase 1. Per the roadmap, Phase 2 ships exactly:

> `layout.json` slot composition (visibility/order/size/position for the
> registry in §3.2); `styles.css` via the new scoped protocol + CSS
> sanitizer; bundled fonts/images; read-only Developer Mode inspector.

Everything else in the proposal (live file-watch hot reload, starter theme
templates, Expert-tier component composition, the in-launcher visual layout
builder) is explicitly later — see §3.

---

## 0. Scope decisions locked before writing any spec

Five calls that shape the work, made up front so no worker has to invent
them mid-dispatch:

1. **Rust validates `layout.json` structurally only; the frontend does
   semantic slot validation.** Exactly Phase 1's precedent for
   `tokens.json` ("schemaVersion present, is an object" in Rust; token
   *semantics* stay a frontend concern, avoiding a second typed copy of
   `Palette` drifting from `palette.ts`). `layout.json`'s worst case if
   wrong is ugly/broken UI, already caught by the Activation Safety Window
   — it does not need a Rust-side copy of `slots.ts` to be safe.
2. **`styles.css` is the one exception: Rust parses and rejects it for
   real, at import time, before a single byte is ever served.** This is
   not the same category as `layout.json` — CSS content is the attack
   surface itself (`@import`, remote `url()`, `expression()`,
   `-moz-binding`, `behavior:`, `javascript:`/`vbscript:` pseudo-protocols),
   not just structured data that can only be ugly when wrong. §8.2's
   reject-list is enforced server-side, fail-closed, whole-file — never
   "strip and continue."
3. **New Cargo dependencies, added only in the packages that need them**
   (mirrors Phase 1's "no zip/image/ttf-parser/CSS parser needed for
   Package 1" discipline): a CSS parser (evaluate `lightningcss` vs.
   `cssparser` — a token-level scan against the reject-list is probably
   enough and lighter than pulling in a full bundler-grade AST; decide
   when Package C is actually dispatched, not here), `image` (raster
   decode + dimension cap), `ttf-parser` (font-table decode, not
   trust-the-extension). All three were explicitly excluded from Phase 1's
   Cargo.toml for exactly this reason — this is where they land.
4. **The Theme Activation Safety Window is not touched.** It already
   guards every activation at every tier (Phase 1 built it tier-agnostic on
   purpose). Phase 2 adds new *content* a theme can ship, not a new
   activation path — no changes to `commands/theme.rs`'s
   arm/confirm/revert trio or `theme-guard.tsx` are in scope here.
5. **`tier: "advanced"` archives stay rejected until Packages C and D both
   land**, not the moment the manifest schema accepts the string. Lifting
   `SUPPORTED_TIER = "basic"` in `archive.rs` is the last change in this
   phase, not the first — an advanced-tier package must have nowhere to
   smuggle unsanitized CSS or a polyglot image through a half-built
   pipeline.

### 0.1 Debt carried over from Phase 1, worth folding in here

`shadows.glowIntensity` was flagged in the Phase 1 plan as "deferred to 4B
within this phase, don't let it slip further than that" — it slipped
anyway; 4B/4D shipped `ThemeExtras` with spacing/radii/typography only,
and `bloom` is still its own standalone `applyTheme()` parameter, not a
`tokens.json` field. Phase 2 touches `apply.ts` again for font loading
regardless (Package F) — fold `bloom` into `shadows.glowIntensity` there
rather than deferring a third time. Small, self-contained, not worth its
own package.

---

## 1. Work packages

Same Target / Change / Constraints / Ownership / Observable-acceptance
shape Phase 1 used. Phase 1's dispatch-mechanics lessons apply
unchanged — see `PHASE1_IMPLEMENTATION_PLAN.md`'s "Dispatch mechanics
learned this session": split before dispatching (not after it's slow),
restate the minimal-comments rule in every spec, verify independently
before merging, expect worktree/orca flakiness. Phase 2 is bigger than
Phase 1 (new protocol + CSS engine + image/font pipeline + a layout
resolver touching ~11 components, vs. Phase 1's storage+archive+
activation-window+store+UI) — expect more packages, each smaller, not
fewer larger ones.

### Package A — Backend: `layout.json` schema (structural only)

**Target:** `src-tauri/src/theme/manifest.rs` or new `theme/layout.rs`,
`theme/mod.rs` (the `get`/`save`/`validate_tokens`-equivalent for layout).

**Change:** `LayoutManifest` — `schemaVersion` + `slots: Map<String, Value>`,
structurally validated only (is an object, `schemaVersion` present) exactly
like `tokens.json` today. No slot-ID or required-child checking in Rust —
see §0 decision 1. `save`/`get` gain an optional `layout.json` alongside
`theme.json`/`tokens.json` when present.

**Constraints:** Don't touch `archive.rs`'s tier gate (§0 decision 5) —
`layout.json` can be *stored* before `tier: "advanced"` archives are
*importable*; Basic-tier hand-authored/duplicated themes never have one.

**Observable acceptance:** round-trip save→get with a `layout.json`
present and absent; a non-object `layout.json` is rejected the same way a
non-object `tokens.json` already is.

---

### Package B — Backend: `tetra-theme://` protocol

**Target:** new `src-tauri/src/theme/protocol.rs`, `src-tauri/src/lib.rs`
(protocol registration in `.setup()`), `src-tauri/tauri.conf.json` (CSP).

**Change:** `register_asynchronous_uri_scheme_protocol` for `tetra-theme:`,
read-only. Every request's path is canonicalized and checked to start with
`data_root()/themes/<id>/` before any read — this is the first custom
protocol in this codebase; get the path-jail reviewed independently, not
just tested (§13.3 of the proposal calls this out explicitly: "getting the
path-jail wrong is a filesystem-disclosure bug, not just a theming bug").
Symlinks are never followed (shouldn't exist post-import per Package D's
archive checks, but the handler double-checks anyway — defense in depth,
not trust-the-import-pipeline). CSP gains exactly `style-src 'self'
tetra-theme:; img-src ... tetra-theme:; font-src 'self' tetra-theme:;` —
`script-src`/`connect-src`/`object-src` unchanged.

**Constraints:** No new `fs:*` capability grant — this is a Rust-side
protocol handler, not a frontend filesystem permission.

**Observable acceptance:** a crafted request path (`../../settings.json`,
an absolute path, a symlink target) is refused; a legitimate
`tetra-theme://<id>/assets/preview.webp` for an installed theme resolves;
one for an id that isn't installed, or a path outside that theme's
directory, does not.

**Extra verification (coordinator's own, not a worker's):** hand-craft the
escape attempts personally, the same way 2A's zip-slip fixtures were
independently reviewed in Phase 1 — this is the highest-blast-radius
package in Phase 2.

---

### Package C — Backend: CSS sanitizer

**Depends on:** nothing structurally (can be written and unit-tested
against raw strings before Package B exists), but is meaningless to ship
without B.

**Target:** new `src-tauri/src/theme/css.rs`, `src-tauri/Cargo.toml` (new
CSS parser dep — see §0 decision 3).

**Change:** `validate_css(source: &str) -> Result<(), String>` — reject
(whole-file, fail-closed) on: `@import`; `url()` targeting anything but a
relative in-package path or a `data:` URI; `expression()`; `-moz-binding`;
`behavior:`; `javascript:`/`vbscript:` pseudo-protocols anywhere in the
source. Cheap-first: a raw substring/token scan for the banned constructs
before any full parse, matching Phase 1's "cheap checks first" ordering
from `archive.rs`.

**Constraints:** No CSS *transformation* (minify, autoprefix, scope) — this
is a gate, not a build step. The file that passes is byte-identical to
what gets served.

**Observable acceptance:** a fixture per rejection case (mirrors 2A's 20
test fixtures for the zip pipeline) plus a valid `styles.css` (the
`[data-tetra-slot="server.row"] { border-radius: 2px; }` shape from §5.2)
passes untouched.

---

### Package D — Backend: image/font content-sniffing + archive allow-list extension

**Depends on:** Package 2 (Phase 1's `archive.rs`) — merged, not touched
structurally, only extended.

**Target:** `src-tauri/src/theme/archive.rs`, `Cargo.toml` (`image`,
`ttf-parser`).

**Change:** Extend the import allow-list past `.json` to
`.css .png .webp .jpg .jpeg .svg .woff2 .woff .ttf .otf .txt .md` (§8.4's
exact list). Every raster image is decoded with `image`, not
trust-the-extension (rejects a `.png` that isn't actually a PNG); decoded
pixel dimensions capped (4096×4096) before/while decoding, not after,
so a decompression-bomb-style image can't blow memory first; every font
file is parsed with `ttf-parser`'s table reader, not just checked for a
magic byte. `.svg` gets a structural XML check (well-formed, no
`<script>`/`on*=` attributes — SVG is the one image format that can carry
script, and the proposal's "no theme-authored code, ever" line (§8.1)
applies to it same as any other file).

**Constraints:** Reuse `stage_for_preview`'s existing streaming/staging
machinery — this package widens what it accepts, it doesn't add a second
extraction path.

**Observable acceptance:** a fixture per new file type (valid PNG/WEBP/
JPEG/SVG/WOFF2/TTF passes; a renamed-extension polyglot of each is
rejected; an oversized-dimension image is rejected before full decode).

---

### Package E — Frontend: layout resolver

**Depends on:** Package A (schema) merged; `src/theme/slots.ts` (Phase 0,
already landed).

**Target:** new `src/theme/layout-store.ts` (proposal's own naming, §13.1),
`src/types/theme.ts` (add `LayoutManifest`/`ResolvedLayout` types).

**Change:** `resolveLayout(slots: Slot[], layoutJson: unknown) ->
ResolvedLayout` — the two-pass resolver from §3.3/§4.1: render every child
the theme's `layout.json` explicitly placed, in its specified order, then
append any `required: true` child the current `slots.ts` defines that the
theme's file never mentioned. Enforces: unknown slot IDs ignored (not
fatal — an old theme referencing a renamed/removed slot loses just that
override); `hidden` may only name `required: false` children, anything
else is a validation error surfaced the same way a bad `tokens.json` field
already is; sizes/positions are literal CSS lengths or spacing-token
references, never a Tailwind class name (§1.3's Tailwind-purge constraint
— this is a hard requirement, not a style preference, since purged classes
that don't appear literally in source silently produce no CSS at all).

**Constraints:** Pure resolver, no rendering — this package produces data,
Package E2 (below) consumes it. Keep this pattern (palette.ts/apply.ts
split) rather than folding resolution into the components themselves.

**Observable acceptance:** unit tests mirroring `palette.test.ts`'s
convention — token/child merge order, the exact "old theme, new required
child" scenario from the brief, the "cannot hide a required child"
rejection.

---

### Package E2 — Frontend: wire the resolver into components (split per surface)

**Depends on:** Package E.

Phase 1's lesson applies directly here: this is exactly the kind of
"needs a new module, touches many files" package that gets pre-split, not
dispatched whole. Suggested split, each independent/parallel (disjoint
files):

- **E2a — Shell** (`shell.sidebar`/`shell.header`/`shell.footer`):
  `App.tsx`, `sidebar.tsx`, `footer-bar.tsx`. Position/size/collapse only
  — the highest-visibility, "radically different" case from §4.2.
- **E2b — Server list** (`server.row`/`server.rowActions`/`filterBar`):
  `server-list.tsx`, `server-row-actions.tsx`, `filter-bar.tsx`. Density/
  order/hidden — the deepest child list in `slots.ts`.
- **E2c — Modals and mods** (`modal.serverInfo`/`modal.modFilter`/
  `mods.toolbar`/`mods.row`/`mods.inspector`/`modal.onboarding`):
  `server-info-modal.tsx`, `mod-filter-modal.tsx`, `mods-tab.tsx`.

**Constraints (all three):** Only reorder/hide/resize — never introduce
new interactive elements a theme's `layout.json` could place, and never
let `hidden` remove a `required: true` child at render time even if
somehow one slipped past Package E's validation (defense in depth: the
renderer itself should also refuse to drop a required child, not only the
validator).

**Observable acceptance (all three):** a fixture `layout.json` per slot
group renders the expected order/visibility/position against a running
`npx tauri build --debug`; the existing default (no `layout.json`, or a
Basic-tier theme with none) renders pixel-identical to today.

---

### Package F — Frontend: `styles.css` + font loading

**Depends on:** Package B (protocol) merged; Package C (sanitizer) merged
and actually gating what's servable.

**Target:** `src/theme/apply.ts`, `src/theme/theme-store.ts`, new
`src/theme/css-loader.ts`/`asset-resolver.ts` (proposal's naming, §13.1).

**Change:** `resolveThemeAsset(themeId, relPath) ->
tetra-theme://<themeId>/<relPath>` — the one sanctioned way a theme's
relative asset path becomes a URL. `apply()` injects/replaces a
`<link rel="stylesheet" href="tetra-theme://...">` for an active
Advanced-tier theme declaring the `css` capability (removed on
deactivation/revert, never left stale). Custom fonts (`typography.
customFonts`) load via the `FontFace` API against the same protocol URL —
same "script mutates the platform directly, sidesteps CSP" trick `--glow`
already uses, so no `style-src` widening for `@font-face` is needed.
§0.1's `bloom` → `shadows.glowIntensity` fold happens here.

**Constraints:** Never `'unsafe-inline'`, never inline the CSS string
directly into the DOM — always the `<link>` + protocol path, per §5.2.

**Observable acceptance:** an Advanced-tier fixture theme with
`styles.css` + a bundled font actually renders the CSS and font in a real
`npx tauri build --debug` run; deactivating it removes the `<link>` and
un-loads the font; `tsc --noEmit`/`vitest run` clean including a
`shadows.glowIntensity` regression test against the existing bloom sweep
(4C's contrast-floor-sweep precedent — must not regress).

---

### Package G — Frontend: real preview thumbnails

**Depends on:** Package B (protocol).

**Target:** `src/components/themes-page/ThemeCard.tsx`,
`ImportThemeDialog.tsx`, `ExportThemeDialog.tsx`.

**Change:** Closes Phase 1's explicit deferral ("every card/thumbnail
preview is a 4-swatch strip... Phase 2 work, once layout/CSS/fonts need
the `tetra-theme://` protocol anyway"). A theme with a `preview` manifest
field and the file actually present renders it via
`resolveThemeAsset(id, "assets/preview.webp")`; the swatch strip stays the
fallback for every Basic-tier theme (the common case) and for a theme
that declares no preview.

**Constraints:** Fallback path must stay — most installed themes will
still be Basic-tier tokens-only with no preview image, per §12's own
example mix.

**Observable acceptance:** `tsc --noEmit` clean; visual check against a
running debug build with one preview-bearing fixture theme installed
alongside ordinary swatch-strip ones.

---

### Package H — Frontend: read-only Developer Mode inspector

**Depends on:** `src/theme/slots.ts` only (already landed) — genuinely
independent of every other Phase 2 package, safe to dispatch in the very
first wave.

**Target:** new `src/components/themes-page/DevModeInspector.tsx`,
`ThemesSection.tsx` (wire the existing disabled "Dev Mode: Off" button —
stubbed disabled in Phase 1 specifically for this).

**Change:** A toggle that outlines the hovered `data-tetra-slot`/
`data-tetra-el` element and shows a small badge: the slot/element's ID,
its required-vs-optional children (from `slots.ts`), and a "copy selector"
action. Read-only — no editing, no `layout.json` writes (that's Phase
3.5). Runs the same `validateLayout` Package E exports to surface inline
errors on the *currently active* theme's `layout.json`, if any, matching
§9's "same validator used at import time runs continuously in Developer
Mode."

**Constraints:** Purely an overlay — must not itself acquire a
`data-tetra-slot`/`data-tetra-el` (it is core chrome, not themeable
content, same posture as the guard window's "no theme has reach here").

**Observable acceptance:** `tsc --noEmit`/`vitest run` clean; manual check
hovering every slot in a running debug build, confirming the badge/copy
action against `slots.ts`'s real content.

---

### Package I — Frontend + backend: tier gate lift, manifest/UI plumbing

**Depends on:** A, B, C, D all merged. **Last package, not first** — see
§0 decision 5.

**Target:** `src-tauri/src/theme/archive.rs` (`SUPPORTED_TIER` gate),
`src-tauri/src/theme/manifest.rs` (`capabilities` enum grows: `"layout"`,
`"css"`, `"fonts"`, `"assets"`), `ImportThemeDialog.tsx`/
`ExportThemeDialog.tsx` (tier badge, "this theme includes: tokens,
layout, custom CSS, fonts" capability line from §6.3).

**Change:** Accept `tier: "advanced"` archives; a package claiming
`"advanced"` with content that requires a capability it doesn't declare in
`theme.json`'s `capabilities` array is rejected — validated, not
descriptive (§6.3).

**Constraints:** `tier: "expert"` stays rejected — untouched, still
Phase 3.

**Observable acceptance:** full round-trip: export an installed
Advanced-tier fixture theme (tokens + layout + CSS + font), reimport it on
a clean profile, confirm byte-identical resolved output — the exact
integration test §14 calls for.

---

## 2. Suggested dispatch order

```
Wave 1 — independent, dispatch together
├── A  — layout.json schema (Rust, structural)
├── B  — tetra-theme:// protocol (Rust) — extra coordinator review, see Package B
├── C  — CSS sanitizer (Rust, testable standalone against raw strings)
├── D  — image/font content-sniffing (Rust, extends archive.rs)
└── H  — Dev Mode inspector (frontend, only depends on slots.ts)

Wave 2 — depends on Wave 1
├── E  — layout resolver (frontend, depends on A)
└── F  — styles.css + font loading (frontend, depends on B + C)

Wave 3 — depends on Wave 2
├── E2a/E2b/E2c — wire resolver into shell/server-list/modals (depends on E)
└── G  — real preview thumbnails (depends on B)

Wave 4 — last, depends on everything
└── I  — lift the tier gate, manifest/UI plumbing (depends on A+B+C+D, all merged)

Wave 5 (coordinator, not delegated) — integration pass
└── Full npx tauri build --debug smoke test; the "torture theme" ZIP from
    §14 exercising every §8.4 rejection case in one file; the three §12
    example themes (Minimal Mono already covered by Phase 1, Sunday Paper
    and Tactical HUD's Advanced-tier half) built and imported for real;
    manual click-through of the Dev Mode inspector and every E2 slot group
    against a running debug build.
```

---

## 3. What stays out of Phase 2

Explicitly deferred, so no worker scope-creeps into it — same spirit as
Phase 1's own §3:

- **Live file-watch hot reload** (Rust `notify` crate, ~100ms re-apply
  loop) — Phase 3, per the roadmap explicitly.
- **Starter theme templates** shipped as real installable directories —
  Phase 3.
- **Expert tier**: declarative component composition
  (`components/server-row.json` etc.), theme settings schema
  (`settings.schema.json`, §4.4) — Phase 3.
- **The in-launcher visual layout builder** (drag-to-reorder, resize
  handles writing `layout.json` directly) — Phase 3.5, and explicitly
  *not* a separately bundled editor app (§9.1/§16.B already settled this).
- **"New Theme" scaffolding from starter templates** — depends on the
  Phase 3 starter-theme work above.
- Any version bump or release tag — separate decision, not implied by a
  phase landing (per `CLAUDE.md`: stop before pushing a version tag).

---

## 4. Before dispatching Wave 1

- Re-read `src/theme/slots.ts` (already landed, Phase 0) — Package E's
  resolver and Package H's inspector both key off its exact shape; don't
  let a spec re-describe it from the proposal's older mockup instead of
  the real file.
- Re-read the merged Phase 1 `archive.rs`/`theme-store.ts` shape before
  writing Package D/E's specs — same discipline Phase 1's own §4 called
  for before 4D.
- Every spec must explicitly restate CLAUDE.md's minimal-comments rule and
  the commit-message style rule — Phase 1 needed a dedicated cleanup pass
  because specs didn't do this reliably; don't repeat that.
- Decide the CSS parser crate (§0 decision 3) before writing Package C's
  spec, not during dispatch — this is a real Cargo.toml/build-time
  tradeoff worth five minutes of comparison first.
- Confirm `theme-system` (Phase 1) is actually merged to `main` before
  branching Phase 2 off of it — building Phase 2 on an unmerged branch
  means every Phase 2 PR also carries Phase 1's diff.
