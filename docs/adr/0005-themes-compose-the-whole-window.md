# Themes compose the whole window

Theme authors want drastically different layouts: navigation across the top instead of down the side, a data table with column headers, detail panels docked beside the list. We considered launcher-provided layout templates, a free canvas where everything is absolutely positioned, and composing the window as one tree, and chose the tree: a shell with an outlet for the current view, one layout file per screen, containers (stack, grid, box, scroll, tabs, accordion), collapsible and resizable regions, and width-based variants, with anchored positioning available on any node.

## Considered Options

- **Templates** keep layouts safe but only offer a fixed menu of shapes, which is exactly the limit that made the reference layout impossible in v1.
- **A free canvas** gives total freedom but can't be validated for usability and breaks at other window sizes and interface scales.

## Consequences

Each screen lives in its own file, so a theme can change one screen without re-authoring the app, and a broken screen can fall back on its own (ADR-0012). Servers, Favourites and Recent are one screen shown in three scopes, so they share one layout file and a theme tells them apart through the published scope.

Settled in the 2026-09-15 design session: Q3, Q17, Q18, Q34, Q44, Q45, Q67, Q73.

## Status
accepted
