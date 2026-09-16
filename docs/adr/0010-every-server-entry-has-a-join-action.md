# Every server entry has a Join action

The reference layout the redesign was measured against joins only from a detail panel. We kept a Join action on every server entry anyway: each entry in the server list must place `server.join`, and how it looks is the theme's choice — its size, its position, a launcher-provided wording variant, even revealing it only on hover — provided it is visible on the selected entry and on the keyboard-focused entry.

Dropping per-entry Join whenever a detail panel exists was rejected; joining a server must never depend on how a theme arranged the rest of the screen.

The server info modal must also place `server.join`, because joining is the modal's primary action and without it the modal is a dead end. A detail panel need not, since every entry it describes already carries one.

Settled in the 2026-09-15 design session: Q6, Q25, Q47, Q70.

## Status
accepted
