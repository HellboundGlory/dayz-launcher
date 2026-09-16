# Every element can be placed anywhere; surfaces are used whole

v1 let a theme rearrange only the children of one slot, so nothing could move between areas of the window. v2 replaces per-slot child lists with one app-wide registry of elements, each placeable anywhere its context allows, plus launcher-provided surfaces — ready-made groups of elements — that a theme uses whole or not at all.

Letting themes edit surfaces in place (hide, reorder or swap their parts) was rejected: it would rebuild a second, slot-style layout system beside composition. A theme that wants different insides composes from elements instead.

## Consequences

Read-only elements may appear any number of times. Stateful controls (search, sliders, toggles, navigation, window controls) appear at most once per screen, and actions on a server at most once per context, because repeated inputs fight over focus and keyboard handling.

Settled in the 2026-09-15 design session: Q4, Q22, Q23.

## Status
accepted
