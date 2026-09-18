// The four container primitives (§5.3). Each takes its node, the already-built
// children, and the shared attrs the node-renderer computed, and folds in its
// own layout style. `as` is the element tag, which a landmark can change.

import type { CSSProperties, ElementType, ReactNode } from "react";
import { ALIGN, JUSTIFY, resolveLength, resolveSpace, type RenderedAttrs } from "./props";
import type { BoxNode, GridNode, ScrollNode, StackNode } from "./types";

interface ContainerProps<N> {
  node: N;
  attrs: RenderedAttrs;
  as: ElementType;
  children: ReactNode;
}

export function Stack({ node, attrs, as: As, children }: ContainerProps<StackNode>) {
  const style: CSSProperties = {
    display: "flex",
    flexDirection: node.direction ?? "row",
    ...(node.wrap === true && { flexWrap: "wrap" }),
    ...(node.align !== undefined && { alignItems: ALIGN[node.align] }),
    ...(node.justify !== undefined && { justifyContent: JUSTIFY[node.justify] }),
    ...(node.gap !== undefined && { gap: resolveSpace(node.gap) }),
    ...attrs.style,
  };
  return (
    <As id={attrs.id} data-region={attrs["data-region"]} className={attrs.className} style={style} data-state={attrs["data-state"]}>
      {children}
    </As>
  );
}

export function Grid({ node, attrs, as: As, children }: ContainerProps<GridNode>) {
  const style: CSSProperties = {
    display: "grid",
    ...(node.columns !== undefined && { gridTemplateColumns: node.columns.map(resolveLength).join(" ") }),
    ...(node.rows !== undefined && { gridTemplateRows: node.rows.map(resolveLength).join(" ") }),
    ...(node.areas !== undefined && { gridTemplateAreas: node.areas.map((row) => `"${row}"`).join(" ") }),
    ...(node.gap !== undefined && { gap: resolveSpace(node.gap) }),
    ...(node.columnGap !== undefined && { columnGap: resolveSpace(node.columnGap) }),
    ...(node.rowGap !== undefined && { rowGap: resolveSpace(node.rowGap) }),
    ...(node.alignItems !== undefined && { alignItems: ALIGN[node.alignItems] }),
    ...(node.justifyItems !== undefined && { justifyItems: ALIGN[node.justifyItems] }),
    ...attrs.style,
  };
  return (
    <As id={attrs.id} data-region={attrs["data-region"]} className={attrs.className} style={style} data-state={attrs["data-state"]}>
      {children}
    </As>
  );
}

export function Box({ attrs, as: As, children }: ContainerProps<BoxNode>) {
  return (
    <As id={attrs.id} data-region={attrs["data-region"]} className={attrs.className} style={attrs.style} data-state={attrs["data-state"]}>
      {children}
    </As>
  );
}

export function Scroll({ node, attrs, as: As, children }: ContainerProps<ScrollNode>) {
  const horizontal = node.axis === "x";
  const style: CSSProperties = {
    overflowX: horizontal ? "auto" : "hidden",
    overflowY: horizontal ? "hidden" : "auto",
    ...attrs.style,
  };
  return (
    <As id={attrs.id} data-region={attrs["data-region"]} className={attrs.className} style={style} data-state={attrs["data-state"]}>
      {children}
    </As>
  );
}

