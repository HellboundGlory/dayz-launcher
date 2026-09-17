# Theme system v2 implementation plan

The staged build plan for theme system v2. `SPEC.md` says what to build; this file says in what order, in what size pieces, and what proves each piece is done.

- **Design decisions:** `docs/adr/0003`–`0024`.
- **Element registry:** `ELEMENTS.md`.
- **Reference layout to reproduce:** `docs/theme-system/reference/tactical-reference.png`.

## Branches and merges

| Stage | Branch | Merge |
|---|---|---|
| 0, 1 | Their own branches off `main` | Straight to `main`, one at a time |
| 2–8 | `theme-phase4` | To `main` only when Stage 8 is done |

Stages 0 and 1 ship user-visible improvements that don't depend on v2, so they don't wait for it. Everything from Stage 2 on is one coherent change to how the interface is built, and a half-finished renderer on `main` would mean two ways to draw every screen.

**Publishing note:** `.github/workflows/pages.yml` deploys `docs/**` on pushes to `main`, and `docs/` is the site root. Merging `theme-phase4` publishes this doc set on tetralauncher.com. That is a deliberate call to make at merge time (Q1).

## Worker dispatch rules

Every package below is sized for one `orca` worker under the standing rules:

- Default agent `omp`; `--worktree new-child`; resolve `~/.config/orca/linux-orca-cli-shim/orca`, not a bare `orca`.
- Branch worktrees for stages 2–8 **from `theme-phase4`**, so the worker gets this doc set. A worktree cut from `main` will not have it, and the spec must then be copied in.
- **Restate the minimal-comments rule in every spec.** Workers don't pick it up from `CLAUDE.md` on their own.
- Every spec names the files to touch, the acceptance checks, and the tests to write. No spec asks a worker to launch the app or click through it.
- Verify every `worker_done` report independently: read the diff, then run the checks yourself.

## Verification commands

| Check | Command |
|---|---|
| Rust format | `cargo fmt --all --check` |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` |
| Rust tests | `cargo test --workspace` |
| Frontend types and build | `npm run build` |
| Frontend tests | `npm test` |
| Frontend lint | `npm run lint` |
| A testable binary | `npx tauri build --debug` |

Clippy warnings are CI errors. GUI verification is the coordinator's job, with the user driving: build, launch, and ask for screenshots.

## Stage 0: the hide filters

**Goal:** expose the four hide filters that already work end to end but have no control (Q9, Q30). Merged to `main` on its own.

**Facts:** `ServerFilter` already carries `hide_empty`, `hide_full`, `hide_locked` and `hide_offline` (`src/types/filters.ts:4`); the store defaults them to `false` and persists them (`src/stores/server-store.ts:57`); `server-list.tsx:340` sends them; `crates/tetra-registry/src/filter.rs` filters on them; `resetFilter` already clears them. Only the controls are missing.

### Package 0.1: the four toggles

- Add four toggle buttons to `src/components/filter-bar.tsx`, right-aligned, labelled "Hide empty", "Hide full", "Hide locked" and "Hide offline", each with `aria-pressed` and a title.
- Register them in `src/theme/slots.ts` under `filterBar` as optional children `hideEmptyToggle`, `hideFullToggle`, `hideLockedToggle` and `hideOfflineToggle`, and mirror them in `src-tauri/src/theme/mod.rs`'s `SLOTS` list.
- Add them, and the existing Reset button, to the filter bar's composition node map, which Reset is missing from today.
- Tests: toggling writes the filter; Reset clears all four; the composition map covers every registered child.

**Acceptance:** the toggles change the list, survive a restart, and Reset clears them. `npm test`, `npm run build`, `npm run lint`, `cargo test --workspace` all pass.

## Stage 1: the launcher features the reference needs

**Goal:** the data and actions a detail panel needs, built as launcher behaviour so v2 only has to place them (Q14, Q38, Q39, Q60). Merged to `main` on its own. Until v2 lands they appear in today's server info modal and ⋯ menu.

### Package 1.1: Workshop details by id, with a size cache

- Add a details-by-ids query to `crates/tetra-steam`: a `Command::UGCQueryDetails(ids, ack)` in `actor.rs` beside the existing `start_workshop_search`, returning the same row shape (`WorkshopSearchRow`), and a `SteamHandle::workshop_details(&[u64])` in `handle.rs`.
- Cache each item's `file_size`, `title`, `preview_url` and `time_updated` for 24 hours, keyed by Workshop id, in the existing registry database.
- Tests: the cache is used inside 24 hours and refreshed after; an unreachable Steam returns the cached rows rather than an error.

### Package 1.2: per-server mod readiness

- Add `server_mod_readiness(addr, query_port)`, returning one row per declared mod: Workshop id, name, state (`ModState`), size, cached preview and whether the mod is unique to this server.
- Sources: `reader.mods_for` for the declared list, `steam_mod_states` for states, package 1.1 for sizes, `reader.unique_mods_for` for uniqueness, and `steam_download_progress` for live progress.
- Sizes follow ADR-0021: a full size for mods that aren't installed, an upper bound for updates, and nothing for ready mods.
- For an offline server, return the last known list from the registry and mark the result stale.
- Tests: mixed states map correctly; missing sizes are reported as unknown rather than zero; a stale result is flagged.

### Package 1.3: check, subscribe, unsubscribe, copy

- `check_server_mods(addr, query_port)`: re-reads the server's rules and the mod states without queueing any download. Build it from today's `verify_server_mods` minus the `refresh_stale` call.
- `unsubscribe_unique_mods(addr, query_port)`: unsubscribes only the mods `get_unique_mods_for` returns, behind a confirmation showing the count and total size (ADR-0020, ADR-0024).
- Subscribe all is today's "Download mods", relabelled.
- Copy address copies `ip:gamePort` to the clipboard.
- Tests: check queues nothing; unsubscribe-unique never touches a mod another cared-about server needs; the confirmation figures match the rows.

### Package 1.4: showing it in today's interface

- The server info modal gets a readiness list, a download-size summary ("up to" wherever updates are counted), and the new actions; the ⋯ menu gets Check mods, Unsubscribe unique mods and Copy address.
- Join's wording gains the `fixAndJoin` variant: "Fix and join" when mods need a download or update.
- Fix the vanishing-notice bug: when a composition replaces the row actions, the W01–W04 and E01 notices currently disappear. Render them beside Join in the composed path too.
- Tests: the notice renders in both the default and composed paths; the wording follows the mod state.

**Acceptance:** for a modded server, the modal lists each mod with its state and size, "up to" appears wherever an update is included, Check mods leaves the download queue untouched, and Unsubscribe unique names the right count. Full check suite green, plus a GUI pass by the user.

## Stage 2: tokens

**Goal:** every hardcoded visual value in the base interface reads from a token, with nothing changing on screen (ADR-0016). From here on, work happens on `theme-phase4`.

### Package 2.0: the visual regression harness

Build it first: it is what proves the rest of this stage changed nothing.

- Playwright drives the Vite frontend in Chromium with the Tauri IPC mocked by fixtures (§25 of `SPEC.md`).
- Fixtures cover a populated server list, an empty list, a modded server with mixed mod states, a Mods list with outdated and downloading mods, and a degraded-storage session.
- Screenshots: every view, every modal, every popup and Settings, at 1400×800 and at 975×620, in dark and light.
- `npm run visual` records baselines; `npm run visual:check` compares.

**Acceptance:** two runs on an unchanged tree produce zero diffs.

### Package 2.1: the token model

- `tokens.json` v2 schema (SPEC §4.1) in both Rust and TypeScript: colours, scales, roles, with a theme's omissions falling back to Neutral.
- Emit `--t-*` variables for scales and roles on the window root beside today's colour variables, which keep their names.
- Start `docs/theme-system/TOKEN-MAP.md`: role, CSS variable, default, and the call sites it covers.

### Packages 2.2–2.4: the refactor

Split by area so each worker owns whole files:

| Package | Files |
|---|---|
| 2.2 | `App.tsx`, `sidebar.tsx`, `window-controls.tsx`, `footer-bar.tsx`, `filter-bar.tsx` |
| 2.3 | `server-list.tsx`, `server-row-actions.tsx`, `server-info-modal.tsx` |
| 2.4 | `mods-tab.tsx`, `mod-filter-modal.tsx`, `update-modal.tsx`, `settings-view.tsx`, `settings-accordion.tsx`, `themes-page/*`, `theme-customiser.tsx` |

Each package replaces hardcoded radii, spacing, text sizes, weights, tracking, leading, borders, shadows, durations and stray hex colours with role variables, extends `TOKEN-MAP.md`, and splits a role whenever two call sites under it differ today (SPEC §4.4).

**Acceptance per package:** `npm run visual:check` reports zero diffs, and no `rounded-[`, `text-[`, `shadow-[`, `duration-`, or bare hex colour remains in those files outside the token layer.

## Stage 3: the registry and the validators

**Goal:** one registry and one validator, both in the backend (ADR-0007, ADR-0023). Nothing renders from them yet.

### Package 3.1: `registry.json`

- Write the registry from `ELEMENTS.md`: elements, surfaces, lists, modals, popups, blocks and the icon allowlist.
- Load it in TypeScript, and compile it into Rust with `include_str!` plus a parse test.
- A test compares the registry against `ELEMENTS.md`'s tables and fails on any disagreement.

### Package 3.2: the layout validator

In Rust, against the registry:

- envelope, node types, props, sizing grammar, positions, region ids, variants, tabs, accordions, collapsible and resizable regions;
- element placement, subjects and contexts, multiplicity, options and free labels;
- required elements per composition, including popups and modals;
- structural limits (SPEC §23).

Every failure carries a stable rule id, the file, a JSON pointer and a message (SPEC §14.4). Fixture packages cover one valid case and one failing case per rule id.

Package 3.2a implements `app_lib::validator::{validate_layout_file, validate_layout_value}` with `LAY-01`–`LAY-12`, `ELE-01`–`ELE-08`, `LST-01`–`LST-06`, and `LIM-01`–`LIM-05`. It borrows a lossless JSON AST, reads the compiled registry, validates list-file `row` envelopes separately, and returns field-level RFC 6901 pointers. Region uniqueness and structural budgets span the file; responsive roots and expanded/collapsed alternatives do not double-count element multiplicity. Required-element checks, cross-file composition checks, and settings expansion remain in the subsequent packages.

### Package 3.3: manifest and archive v2

- `theme.json` v2: fields, capabilities checked against the files shipped, `previews`, reserved `builtin.` ids, `themeApi` major 2, computed minimum launcher version.
- Archive limits: 64 files and 8 MB uncompressed, depth 3 and images ≤ 4096px unchanged (Q66).
- The package path allowlist (SPEC §3.1): anything outside it is refused.
- v1 packages are refused with a clear message, and v1 folders on disk are reported as incompatible (ADR-0003).

### Package 3.4: variants and settings combinations

- Expand every breakpoint variant against every settings combination, capped at 4 × 64, and validate each.
- Collapsed subtrees, tab panes and accordion sections are checked locally, so they don't multiply the count.

## Stage 4: the layout renderer

**Goal:** the launcher draws every screen from layout files, and v1 is deleted in the same stage (ADR-0003).

| Package | Scope |
|---|---|
| 4.1 | Renderer core: file loading, envelope, containers, leaves, sizing, positions, regions, variants, stacking, outlets |
| 4.2 | Element host: `data-el`, parts, states, options, wording variants, icons, subjects and contexts; ports the shell, navigation, status and notices |
| 4.3 | Lists: columns, launcher header, row templates, virtualization, measured heights, the grid keyboard model, row states; ports the server and Mods lists |
| 4.4 | Modals, popups, Settings presentations, tabs, accordions, collapsible and resizable regions, with their persisted state |
| 4.5 | The visibility check (SPEC §15), per-file fallback, the fallback notice, and auto-placement |
| 4.6 | Neutral as a compiled-in package (ADR-0019), then deleting v1 |

Package 4.6 deletes: `src/theme/slots.ts`, `component-tree.ts`, `component-tree-renderer.tsx`, `slot-children.ts`, `slot-order.ts`, `slot-render.tsx`, `use-component-composition.ts`, `layout-store.ts`, `use-resolved-layout.ts`, the `SLOTS` list and composition ceiling in `src-tauri/src/theme/mod.rs`, the tier field and its checks, and `typography.customFonts`.

**Acceptance for the stage:** every screen renders through the renderer with Neutral, `npm run visual:check` reports zero diffs, and no `data-tetra-slot` attribute remains.

## Stage 5: CSS API, theme settings and list sorting

| Package | Scope |
|---|---|
| 5.1 | Cascade layers `launcher`, `theme` and `guarantees`; the CSS validator rewritten on `cssparser` (already a dependency) to enforce SPEC §12: allowed selectors, `t-` classes, parts, states, at-rules, and the refusals |
| 5.2 | `@font-face` from package fonts only, and removal of v1's `customFonts` |
| 5.3 | Theme settings v2: `number`, `boolean`, `choice` and `color`; `{{id}}` into tokens and layout; `--setting-<id>` in CSS; settings-driven `hidden`; per-theme storage |
| 5.4 | Mods sorting as launcher behaviour: the new `status` key and its comparator, so column headers can sort (ADR-0018) |

**Acceptance:** a fixture theme exercising every allowed selector passes; one fixture per refusal fails with the right rule id; a settings change repaints without a reload; sorting the Mods list by each key is covered by tests.

## Stage 6: Dev Mode v2

| Package | Scope |
|---|---|
| 6.1 | Outlines for regions and elements with ids and contexts, and the click-to-pin inspector carried over |
| 6.2 | The validation panel: errors and warnings with rule id, file and pointer, the reason a screen fell back, contrast warnings, and copy-selector |
| 6.3 | The variant and settings-combination switcher, and hot reload keeping the last valid file |

**Acceptance:** a deliberately broken fixture theme shows the failing rule and pointer for each of its mistakes, and the switcher reaches every variant and combination.

## Stage 7: built-ins, starters and the author's guide

| Package | Scope |
|---|---|
| 7.1 | Three starters (`Colours only`, `Styled`, `Custom layout`), each with a `README.md` explaining its files, and the scaffolding flow updated to them |
| 7.2 | Seeding and theme management v2: capability labels, `previews` in the grid and import preview, incompatible-theme listing and the startup switch to Neutral |
| 7.3 | `docs/theme-system/AUTHORING.md`: worked examples built on the three starters, including the tab-order rule and the CSS API by example |

**Acceptance:** each starter imports, activates and passes validation unchanged; a v1 folder on disk lists as incompatible and can only be deleted.

## Stage 8: Tactical v2, performance and the final pass

| Package | Scope |
|---|---|
| 8.1 | Tactical v2 as a package only: top nav tabs, a column-header table, a persistent detail panel with per-mod readiness, the hide toggles, square corners, a compact per-row Join |
| 8.2 | Performance: measure the budgets in the harness and fix what misses them |
| 8.3 | Final pass: manual WebKitGTK verification by the user, docs synced, `DESIGN.md` and `CHANGELOG` updated |

**Acceptance:** Tactical v2 matches `docs/theme-system/reference/tactical-reference.png` side by side, with no Tactical-specific launcher code; every budget in SPEC §24 is met; Neutral is still pixel-identical.

## CI

Two additions to `.github/workflows/check.yml`:

- **Visual regression:** install Playwright's Chromium and run `npm run visual:check` on the Linux job. Baselines are committed; a diff fails the build.
- **Registry agreement:** the `registry.json` versus `ELEMENTS.md` test runs inside `npm test` and `cargo test --workspace`, so neither side can drift alone.

## Risks

| Risk | Mitigation |
|---|---|
| Chromium and WebKitGTK render slightly differently, so a green harness isn't proof | The harness gates every stage; one manual pass on the real build gates the release (Q55) |
| Virtualized lists plus grid semantics can break the keyboard model | The keyboard model is specified in SPEC §8.4 and tested in package 4.3, before any theme depends on it |
| The visibility check costs layout reads on every open and resize | One batched read-only pass, a 16 ms budget measured in the harness, and no run on data updates |
| The token refactor is large and easy to drift on | `TOKEN-MAP.md` records every role and its call sites, and the harness proves each package changed nothing |
| Stages 0 and 1 land on `main` before v2 exists | Both are complete features on their own, shown in today's interface, and neither depends on the renderer |

## Done

The stage plan is complete when every item in SPEC §1.2 holds. The two extra showcase themes come after that, not as part of this plan.
