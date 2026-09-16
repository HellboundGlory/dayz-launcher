# A broken screen falls back on its own

When a layout file fails validation or the visibility check, only that screen falls back to Neutral's layout (a broken shell falls back to Neutral's shell). The theme's tokens and CSS stay in effect, and the user sees one notice per theme per launcher version. Rejecting the whole theme was the alternative; it would make every small mistake, and every launcher update that trips a rule, cost the user their entire theme.

## Consequences

- When a launcher update makes a new element required, it is placed automatically at that element's fallback position instead of failing the screen.
- A renamed element keeps its old id as an alias for all of theme API 2.x.
- A removed optional element is dropped with a Dev Mode warning, and the screen still renders.
- While Dev Mode is hot-reloading, an invalid file keeps showing its last valid version, so a typo doesn't flash the default layout.

Settled in the 2026-09-15 design session: Q26, Q52, Q62.

## Status
accepted
