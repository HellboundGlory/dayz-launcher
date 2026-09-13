// The presentational half of theme-driven child order. Children only move
// within the DOM grouping that already holds them, so a component renders one
// of these per group: `order` is that group's ids from `resolveChildOrder`, and
// a `null` node renders nothing, so a child's own condition still decides
// whether it appears.
import { Fragment, type ReactNode } from "react";
import { useResolvedSlot } from "./use-resolved-layout";
import { isChildVisible } from "./slot-order";

export function SlotChildren({
  order,
  nodes,
}: {
  order: string[];
  nodes: Record<string, ReactNode>;
}) {
  return (
    <>
      {order.map((id) => (
        <Fragment key={id}>{nodes[id] ?? null}</Fragment>
      ))}
    </>
  );
}

/** A child with no sibling in the markup to move against — a modal's ✕, a tab
 * strip, a footer button — so a theme can only hide it. */
export function SlotChild({
  slotId,
  id,
  children,
}: {
  slotId: string;
  id: string;
  children: ReactNode;
}) {
  const resolved = useResolvedSlot(slotId);
  return <>{isChildVisible(slotId, id, resolved.children) ? children : null}</>;
}
