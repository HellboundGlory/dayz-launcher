# Capabilities replace tiers

v1 classified themes as Basic, Advanced or Expert and gated import on the tier. With one composition model the ladder no longer tells anyone something the files don't, so a v2 manifest just lists its capabilities (`tokens`, `css`, `fonts`, `images`, `layout`, `settings`), import checks them against the files actually shipped, and the theme grid derives a plain label from them: "Custom layout", "Styled" or "Colours". Keeping tiers as gates was rejected because every tier boundary would have to be redefined for v2 and would still only restate the capability list.

Settled in the 2026-09-15 design session: Q16, Q50. Supersedes the tier half of ADR-0001.

## Status
accepted
