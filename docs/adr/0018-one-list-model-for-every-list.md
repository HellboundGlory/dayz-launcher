# Every list uses one list model

Server lists, the Mods list, mod filter results, the servers needing a mod and a server's required mods all use the same model. A list declares its named columns once; a launcher-rendered header shows them, and clicking a sortable column sorts. A row template places elements into those same columns, so the header and every row always line up. Entries carry published states for CSS, and row heights are measured rather than fixed.

## Consequences

- Large lists (servers, mods, mod filter results) are virtualized, so a list owns its own scrolling and can't be placed inside another scrolling container.
- A column header sorts only through a launcher sort key. The Mods list therefore gains a status sort, and its existing name, subscribed, updated and size sorts, which no control currently reaches, become reachable.

Settled in the 2026-09-15 design session: Q27, Q49, Q58, Q75.

## Status
accepted
