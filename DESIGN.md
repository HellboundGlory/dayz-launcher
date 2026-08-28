# Project Design Memory (DESIGN.md)

Tetra Launcher — design contract. The visual system for this app, recorded so
every future session builds on it instead of drifting. Source of truth for the
look: `mockups/final-integrated-board.html` (V4 Glow board); the implementation
spec is `PLAN.md`; this file records the *decisions*.

## 1. Product Intent

- **What is this product, in one or two sentences?**
  A fast, native DayZ server browser and mod manager (Tauri desktop app). Browse
  and filter thousands of servers, verify mods before joining, manage Workshop
  subscriptions, and get into a game without tabbing out to a website.
- **What is the primary job the interface must not fail at?**
  At-a-glance triage of a dense server list: name, players, ping, mods, region —
  readable in a single glance, with a join path of at most two clicks.

## 2. Users & Usage Context

- **Who is the primary user?** DayZ players — casual to hardcore. Technical
  fluency varies, but every user is a PC gamer running Steam. They are
  intolerant of slow UIs and opaque failures (the app is a game launcher; it
  either works or it's noise).
- **Context:** desktop-only, usually mid-game-session. High information density
  is a feature; so is clarity about state (connecting, refreshing, offline).

## 3. Visual Personality

- **In three adjectives:** precise, technical, confident.

## 4. Archetype / Direction

- **Active archetype(s):** Precision Technical blended with Dense Enterprise
  (a high-throughput data browser: thousands of rows, sort/filter surfaces,
  mono data). The signature is the **V4 Glow** — a 5-layer soft neon halo on
  accent elements that scales with the user-controlled `bloom` slider. That is
  the one visual flourish; everything else is quiet and data-dense.

## 5. Color & Semantic Tokens

Semantic tokens only — components never carry raw hex (the token-bypass scan
`audit-hardcoded-colors` enforces this; a few known legacy hexes remain in
splash/steam-modal/update-modal, tracked as debt, not a license for new ones).
Tokens are **hex strings on CSS custom properties** (not OKLCH — the palette
math, `deriveLight`, is ported verbatim from the locked board and is
hex-based; do not migrate without re-locking the board).

Theme model: every theme is a **dark/light pair** (dark authored, light derived
to a 4.5:1 contrast floor by `src/theme/palette.ts deriveLight`). The engine
writes tokens onto `<html>` inline via `applyTheme`; re-theming costs one style
write, zero re-renders.

Base tokens (12): `--bg --surface --surface2 --border --text --muted --muted2
--accent --accent2 --success --warn --danger`.

Derived alpha tokens (never use Tailwind `/NN` opacity modifiers on var()
colors — that compiles to invalid `rgb(var(--x) / N)` and silently drops the
declaration): `--border-weak --muted-soft --accent-soft --accent-line
--accent2-soft --accent2-line --warn-soft --danger-soft --danger-line
--row-hover --row-selected --glow`.

Default: **dark, Neutral** (`#0d0f13` bg). Six presets: Neutral, Emerald,
Blaze Orange, Magenta Pulse, Esports Blue, Ember Red — each with authored dark
+ derived light. Users can save custom skins (`localStorage["tetra.customThemes"]`)
and edit any token live.

```css
/* Neutral dark (canonical base, main.css :root) */
--bg: #0d0f13; --surface: #12151b; --surface2: #1a1e26; --border: #262b34;
--text: #e7ebf0; --muted: #7a8494; --muted2: #98a2b2;
--accent: #8fa3bd; --accent2: #b0976a;
--success: #4d9a75; --warn: #c19a55; --danger: #b3564d;
```

- **Dark mode default:** yes, dark. Light is a first-class mode (auto-derived,
  switchable live, persisted) — never a dead toggle.

## 6. Typography

- **UI:** Inter 400/500/600/700/800, **bundled woff2** under `src/assets/fonts/`
  (no CDN — the app must render identically offline). `--font-ui`.
- **Data:** JetBrains Mono 400/500/600 (`--font-data`), used for every number,
  address, timestamp and size.
- **Scale:** deliberately small — 8–13px UI text, 13px mono for the stat
  clusters. Density wins; readability is carried by weight/color contrast, not
  size.

## 7. Spacing

- **Spacing grid:** custom micro-grid — 2px steps up to 8px, then 8px steps
  (2/3/4/6/7/8/10/12/14/16/18/22). 1px hairlines via `--border`.
- App shell padding: 8px rows, 10–18px panel padding.

## 8. Density

- **Layout density target:** Dense — a 1400×800 window holds 20+ server rows,
  each with title, meta line, and three stat clusters. The Mods tab and
  Settings are the two places that relax to "comfortable".

## 9. Geometry

- **Global radius:** window 8px (board `.win`); controls 6–7px; rows 8px;
  chips/tags 3px; pills/dots 999px.

## 10. Surfaces & Elevation

- **Elevation model:** border rules + glow. Surfaces are flat tonal layers
  (`--bg` → `--surface` → `--surface2`) separated by 1px `--border` lines; the
  only shadows are `--glow` (accent halo), dropdown shadows
  (`0 8–10px 24–28px rgba(0,0,0,.4–.5)`), and the modal shadow.

## 11. Iconography

- **Primary icon set:** Lucide, strokeWidth 1.6. No icon fills except the
  favourited star.

## 12. Navigation

- **Primary navigation model:** persistent sidebar, 220px icon+label rail ⇄ 52px
  icon-only (edge collapse tab). Views: Servers, Favourites, Recent, Mods +
  Settings gear. Width driven by `--side-w` so the Settings overlay tracks the
  collapse without subscribing.

## 13. Components

- **Primary component/primitive source:** Custom. No shadcn/Radix/MUI — the
  board vocabulary (`.l2-row`, `.fdrop`, `.sec`, `.mx-row`, `.footer-v2`, …) is
  implemented as Tailwind utilities with the board class names kept as semantic
  hooks. One primitive engine: Tailwind v3 + the token classes in
  `tailwind.config.js`.

## 14. Data Visualization

- **Charting engine:** none — all metrics are text/mono (`players/max`, ping,
  mod count, sizes). Deliberate: raw numbers are faster to scan than bars in a
  list this dense. (A player-count bar in the server row was explored and
  dropped at the board stage.)

## 15. Motion

- **Motion engine:** CSS transitions/animations only (`transition-colors`,
  `animate-pulse` for live indicators). Global kill-switch in
  `main.css` for `prefers-reduced-motion`. Glow radius updates are instant
  (CSS var change, no transition).

## 16. Responsive Behavior

- **Breakpoint scale:** none — fixed desktop window (1400×800, min 975×620).
  No responsive/mobile behavior is designed; the UI scale slider (1.0–1.5)
  is the accessibility lever instead.

## 17. Accessibility

- **Target:** WCAG 2.2 AA. Beyond baseline:
  - **Contrast floor 4.5:1 is enforced mechanically** — `deriveLight` tunes
    accent/success/warn/danger to the darkest lightness that clears the floor
    against derived `light.bg`, and `src/theme/palette.test.ts` sweeps hues
    0–359 + every preset light to lock it (`node src/theme/palette.test.ts`).
  - Keyboard: roving tabindex everywhere (sidebar nav, accordion headers,
    settings tabs), arrow-key dropdown menus, focus trap + Esc + backdrop in
    the M1 modal, `aria-expanded`/`aria-current`/`aria-selected` on the stateful
    controls, labelled icon-only buttons (collapse tab, window controls, star,
    color swatches).
  - Global `:focus-visible` fallback in `main.css` so nothing interactive can
    lose its outline even if a component forgets a ring utility.

## 18. Project-Specific Anti-Patterns (STRICT NEVER)

- Never use a Tailwind opacity modifier on a `var()` color (`bg-accent/50`,
  `border-danger/30`, `hover:text-warn/80`) — it compiles to invalid CSS and
  silently vanishes. Use the derived alpha tokens (`--accent-soft`,
  `--danger-line`, …). This bit us twice (invisible Unsubscribe button,
  invisible dropdown chevron); the plan's §1.2 rule is load-bearing.
- Never reintroduce shadcn HSL tokens (`--background`, `border-border`,
  `hsl(var(--...))`) — `border-border` no longer exists and the app is fully
  on V4 tokens.
- Never use `calc(var(--bloom) * Npx)` in CSS — the multiplication operator is
  not supported on every engine the app ships on (WebKitGTK drops the whole
  `--glow` value, making every glow vanish and the bloom slider appear dead).
  Resolve radii in JS (`applyTheme`).
- Never load fonts from a CDN — the typefaces are bundled and must stay bundled.
- Never add a second theme engine or a second primitive/component system.
- Never put the app's raw data colors in components — ping/player/status colors
  come from `--success/--warn/--danger`, not `#22c55e`-style literals.

## 19. Component Sources & Exceptions

- **Primary primitives:** custom Tailwind components (see §13).
- **Recorded exceptions to the locked board (deliberate, do not silently revert):**
  - **Window controls strip** — the board has no min/max/close, but the real
    window is `decorations: false`; without them the launcher is uncloseable.
    Slim 28px top-right strip (`window-controls.tsx`); doubles as the drag region.
  - **Scale slider width 120px** (board: 46px) — user request: the 46px track
    made each 0.05 step ~4px and the slider felt hair-trigger.
  - **Sidebar logo** is the real TETRA mark (`src/assets/tetra-logo.png`),
    not the board's CSS square.

## 20. Open Questions / Not Yet Decided

- Light-mode polish for user-created skins is implemented via `deriveLight`;
  no known gaps. (The "light for user skins" plan from the mockup phase is
  closed.)
- Horizontal overflow behavior of very long server names at <975px width is
  handled by truncation; no scrollable tables are planned.

## 21. Design Decisions Log

Append-only. Each entry: date, what was decided, why, and what it overrides.

- [2026-08-28]: **V4 Glow design locked** — `final-integrated-board.html` is the
  sole visual spec; `PLAN.md` the implementation spec. Overrides the pre-overhaul
  shadcn/HSL theme and the old resizable server-table layout.
- [2026-08-28]: **Theme engine is CSS-driven** — palette as custom properties on
  `<html>`, zero component subscriptions; React only owns the editor. New
  additive store (`useThemeStore`); no store/backend churn.
- [2026-08-28]: **Dark/light pair model + auto-derive** — every theme carries a
  derived light palette with a 4.5:1 floor (`deriveLight` ported verbatim from
  the board, locked by the hue-sweep test). Overrides the old single-dark theme.
- [2026-08-28]: **Neutral dark is the shipped default**; six presets + user
  skins; active selection persisted under `localStorage["tetra.themeActive"]`
  (added when the theme reverted on restart), skins under `tetra.customThemes`.
- [2026-08-28]: **Settings moved from a modal to a full-page overlay** with
  one-open accordions (Game / Launcher / Server Browser / Theme), all sections
  collapsed by default. Overrides `settings-modal.tsx`.
- [2026-08-28]: **Details rail removed** — selection highlights the row; the
  ⋯ menu (D2) + More-info modal (M1) carry the actions. Overrides the 340px
  `server-details.tsx` rail.
- [2026-08-28]: **Window corners** — board's 8px radius + 1px border on the app
  root, `body` transparent (window already `transparent: true`). The radius was
  previously missing entirely.
- [2026-08-28]: **Glow radii resolved in JS, not `calc(var(--bloom) * Npx)`** —
  WebKitGTK drops calc multiplication, which silently killed every glow and made
  bloom appear non-functional. Fix in `applyTheme`; static fallback in
  `main.css` uses literal px at bloom 0.9.
- [2026-08-28]: **Marketing site (docs/) adopts the V4 language** — the static
  site (index/download/join) now ships the same tokens as the app: the V4
  Neutral dark palette, bundled Inter + JetBrains Mono woff2 (same files the
  app ships, no CDN), the 5-layer glow on CTAs/active states/live dots, and the
  L2-row vocabulary for the feature grid. Hero is the abandoned-ruin photo
  under a V4-toned wash (darker on the text side) with a bottom fade into the
  page bg. Overrides the pre-V4 Oswald/IBM Plex + moss/night/signal-blue site
  palette. Motion is CSS-only, slow, and fully gated behind
  `prefers-reduced-motion`; hit targets are ≥24px (nav full-height, 25px
  carousel dots).
