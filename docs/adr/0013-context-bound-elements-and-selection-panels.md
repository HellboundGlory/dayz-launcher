# Elements read a context; free-standing panels follow the selection

Server- and mod-specific elements declare which context they describe — the entry they sit in, the modal they're inside, or the selection — and a detail panel is simply a region bound to the selection. The selection is shared across the whole window, survives view switches and refreshes but not restarts, stays when filters hide the selected server, and moves with the arrow keys.

Hover-driven panels were rejected: they thrash while scrolling tens of thousands of servers, and keyboard users can't reach them. Enter never joins, so a stray keypress can't launch the game.

Settled in the 2026-09-15 design session: Q7, Q28, Q29.

## Status
accepted
