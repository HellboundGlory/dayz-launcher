# Theme system v2 replaces v1 with no compatibility layer

The v1 package format (per-slot `layout.json`, `components/<slot>.json`, three tiers) reached `main` but never shipped in a release, and the only v1 packages in existence are bundled ones and local test themes. v2 changes the model from rearranging children inside fixed slots to composing the whole window, so we replace the format outright: `themeApi` 2.0, v1 packages refused at import, every bundled theme rewritten, and the v1 code deleted in the same stage the v2 pipeline lands. Supporting both would mean two validators and two renderers forever, to protect themes no user has.

## Consequences

v1 theme folders already on disk (developer machines only) are listed as incompatible themes that can only be deleted; if one is active at startup the launcher switches to Neutral with a one-time notice. Seeding replaces a bundled theme whose folder is incompatible, but never a valid copy the user has edited.

Settled in the 2026-09-15 design session: Q2, Q61.

## Status
accepted
