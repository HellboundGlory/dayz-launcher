// The rendering half of the layout resolver: which of a slot's children a
// component puts on screen, and in what order. A separate module because a
// slot whose markup spans several containers (server.row) applies the same two
// rules once per group.

import type { ResolvedSlotLayout } from "./layout-store";

/** The ids to render, in the order the active layout resolved to.
 *
 * `slot.children` is authoritative order, so filtering *it* — not the caller's
 * `group` array — is what lets a theme reorder a child at all; `group` only
 * narrows the result to the children one DOM region renders.
 *
 * A `required` id renders even when `hidden` names it, and is appended if the
 * resolved children omitted it: `resolveLayout` refuses to hide required
 * children, but a component must not depend on that refusal to keep required
 * content on screen. */
export function slotChildrenToRender(
  slot: ResolvedSlotLayout,
  required: readonly string[] = [],
  group?: readonly string[],
): string[] {
  const allowed = group ? new Set(group) : null;
  const hidden = new Set(slot.hidden);

  const ids = slot.children.filter(
    (id) => (allowed === null || allowed.has(id)) && (!hidden.has(id) || required.includes(id)),
  );
  for (const id of required) {
    if ((allowed === null || allowed.has(id)) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
