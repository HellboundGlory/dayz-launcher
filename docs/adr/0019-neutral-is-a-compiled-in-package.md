# Neutral is a compiled-in package

Neutral's layout and palette ship inside the launcher as a read-only theme package, loaded through the same v2 pipeline as any other theme, rather than as the launcher's hard-wired interface. It is never copied into the user's themes folder, so it can't be deleted or corrupted there; it proves the v2 format can express the launcher's own interface pixel-for-pixel; and it is what every fallback shows (ADR-0012).

Keeping the default interface as code with themes layered on top was rejected: it would leave two ways to render every screen, and fallback would switch between them rather than between two layouts in one renderer.

Settled in the 2026-09-15 design session: Q37.

## Status
accepted
