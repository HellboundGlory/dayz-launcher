/** The list arithmetic the layout popover needs, kept out of the component so
 * it can be tested without a DOM: which row a pointer is over, the optimistic
 * list a drag produces, and where a hidden row is listed. */

export interface RowRect {
  top: number;
  bottom: number;
}

/** The row index a pointer at `y` is over: the first row whose bottom edge is
 * still below it, or the last row once it is past them all. The rects are the
 * rows as they are currently on screen, so the result is directly the index the
 * dragged row lands on. */
export function dropIndexFor(y: number, rows: readonly RowRect[]): number {
  for (let index = 0; index < rows.length; index++) {
    if (y < rows[index].bottom) return index;
  }
  return Math.max(0, rows.length - 1);
}

/** `ids` with the row at `from` moved to `to` — the visual list while dragging,
 * and the exact order committed on release. */
export function moveItem(ids: readonly string[], from: number, to: number): string[] {
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** A slot's rendering children with its hidden ones put back where the registry
 * order puts them. The popover is the one place a hidden child still has to be
 * listed, at its normal position, so its eye can turn it back on. */
export function orderWithHidden(
  visible: readonly string[],
  hidden: readonly string[],
  registry: readonly string[],
): string[] {
  const ids = visible.slice();
  for (const id of hidden) {
    if (ids.includes(id)) continue;
    const rank = registry.indexOf(id);
    const at = ids.findIndex((other) => {
      const otherRank = registry.indexOf(other);
      return rank !== -1 && otherRank !== -1 && otherRank > rank;
    });
    if (at === -1) ids.push(id);
    else ids.splice(at, 0, id);
  }
  return ids;
}
