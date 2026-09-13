// How a component's hardcoded children are re-rendered in the order a theme
// asked for. The decisions are pure functions of the slot's resolved list, so
// they live here and are tested against the resolver; `slot-children.tsx` is
// the presentational half. A component calls `useResolvedSlot` once per slot and
// derives every group it renders from that one list.
import { SLOTS } from "./slots";

/** The ids to render out of one DOM group of a slot's children, in render order.
 *
 * A slot's *registry* order is logical, not a DOM sequence — the markup nests
 * some children inside a shared wrapper — so it is never adopted for its own
 * sake. Each group is judged on its own: unless the theme's order disagrees with
 * the registry's about the children rendering in *this* group, the group keeps
 * the sequence its JSX wrote. Hiding only removes ids from both sides, so it
 * never reshuffles a group; ordering one nested group can't disturb the group
 * holding it; and with no layout.json every group stands, which is what makes
 * that render identical to the hardcoded one. A theme that spells out the
 * registry's own sequence for a group lands there too, and no resolved data
 * distinguishes it from a theme that named the group not at all.
 *
 * Where the theme did pin an order, its list is authoritative — the resolver
 * drops an optional child that order omits — and the group's ids are ranked by
 * it. A wrapper is one position, ranked by whichever of the children it holds
 * the theme places first. Every `required: true` child renders regardless of the
 * resolved list, the resolver having already refused to hide one.
 *
 * `markup` is one group of true siblings, so ids from another group of the same
 * slot are ignored. A `wrappers` entry names an id standing for a wrapper
 * element that holds several of the slot's children.
 */
export function resolveChildOrder(
  slotId: string,
  markup: string[],
  resolved: string[],
  wrappers: Record<string, string[]> = {},
): string[] {
  const registry = SLOTS.find((slot) => slot.id === slotId)?.children;
  // A slot id the registry doesn't have is a wiring mistake, not a theme one —
  // render the markup as written rather than blanking it.
  if (!registry) return markup.slice();

  const resolvedRank = new Map(resolved.map((id, index) => [id, index]));
  const required = new Set(registry.filter((child) => child.required).map((child) => child.id));
  const renders = (id: string) => resolvedRank.has(id) || required.has(id);
  const held = (id: string) => wrappers[id] ?? [id];
  const ids = markup.filter((id) => held(id).some(renders));

  // Both sides are restricted to the children that render — a hidden one is
  // absent from `resolved` but may still be named by a wrapper, and leaving it
  // in would make the two lists differ where the theme moved nothing.
  const inGroup = new Set(ids.flatMap(held).filter(renders));
  const registryOrder = registry.filter((child) => inGroup.has(child.id)).map((child) => child.id);
  const themeOrder = resolved.filter((id) => inGroup.has(id));
  if (
    registryOrder.length === themeOrder.length &&
    registryOrder.every((id, index) => id === themeOrder[index])
  ) {
    return ids;
  }

  const rankOf = (id: string) =>
    Math.min(...held(id).map((child) => resolvedRank.get(child) ?? Number.POSITIVE_INFINITY));
  const ranked = ids.map((id, index) => ({ id, index, rank: rankOf(id) }));
  // A group member the theme's order never reached can only come from a
  // malformed resolved list — `resolveLayout` appends every required child it
  // was not told about — and guessing where it belongs would reshuffle the
  // group, so render the markup's order instead.
  if (ranked.some((entry) => entry.rank === Number.POSITIVE_INFINITY)) return ids;
  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.id);
}

/** Whether one of a slot's children should render. A `required: true` child
 * always does: `resolveLayout` refuses to hide one, and this is the second line
 * of defence, in the component rather than only in the resolver. */
export function isChildVisible(slotId: string, id: string, resolved: string[]): boolean {
  const required = SLOTS.find((slot) => slot.id === slotId)?.children.find(
    (child) => child.id === id,
  )?.required;
  return required === true || resolved.includes(id);
}
