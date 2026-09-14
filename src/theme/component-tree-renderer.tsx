// The presentational half of component composition: a `ResolvedNode` — already
// validated, so nothing here re-checks anything — turns into JSX. One
// implementation for every composed slot; the tree's own nodes decide layout.
// Stacking order is declaration order, since the recursive walk emits children
// in order: there is no z-index primitive, by design.

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { resolveThemeAsset } from "./asset-resolver";
import type { Position, ResolvedNode } from "./component-tree";

type ContainerNode = Extract<ResolvedNode, { type: "stack" | "box" | "grid" }>;
type Direction = NonNullable<ContainerNode["direction"]>;
type Align = NonNullable<ContainerNode["align"]>;
type Justify = NonNullable<ContainerNode["justify"]>;

// Fixed lookups of literal class names: Tailwind's content scan only sees
// strings written in this file, so a synthesized `flex-${direction}` would ship
// with no CSS behind it.
const FLEX_DIRECTION: Record<Direction, string> = { row: "flex-row", column: "flex-col" };
const FLEX_ALIGN: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};
const FLEX_JUSTIFY: Record<Justify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  "space-between": "justify-between",
};

/** A container's own props. `stack` lays out with literal flex classes; `grid`
 * and every `gap` use inline styles; `box` groups and pads only, so
 * direction/align/justify/wrap — and `gap`, which does nothing outside flex or
 * grid — are ignored there. */
function containerProps(node: ContainerNode): {
  className?: string;
  style?: CSSProperties;
} {
  if (node.type === "box") return {};
  if (node.type === "grid") {
    return {
      style: {
        display: "grid",
        ...(node.gap !== undefined && { gap: node.gap }),
        ...(node.direction !== undefined && { gridAutoFlow: node.direction }),
        ...(node.align !== undefined && { alignItems: node.align }),
        ...(node.justify !== undefined && { justifyContent: node.justify }),
      },
    };
  }
  const className = cn(
    "flex",
    FLEX_DIRECTION[node.direction ?? "row"],
    node.wrap === true && "flex-wrap",
    node.align !== undefined && FLEX_ALIGN[node.align],
    node.justify !== undefined && FLEX_JUSTIFY[node.justify],
  );
  return node.gap === undefined ? { className } : { className, style: { gap: node.gap } };
}

/** A free-positioned node's inline placement. An edge or corner anchor pins to
 * the side it names and applies that side's offset to the same side, so a
 * negative `x`/`y` nudges the node outward; a centred axis has no side to
 * measure from, so its offset rides along inside the centring transform. */
function positionStyle({ anchor, x, y }: Position): CSSProperties {
  const style: CSSProperties = { position: "absolute" };
  const shifts: string[] = [];
  if (anchor.startsWith("top") || anchor.startsWith("bottom")) {
    style[anchor.startsWith("top") ? "top" : "bottom"] = y ?? 0;
  } else {
    style.top = "50%";
    shifts.push(`translateY(${y === undefined ? "-50%" : `calc(-50% + ${y})`})`);
  }
  if (anchor.endsWith("left") || anchor.endsWith("right")) {
    style[anchor.endsWith("left") ? "left" : "right"] = x ?? 0;
  } else {
    style.left = "50%";
    shifts.push(`translateX(${x === undefined ? "-50%" : `calc(-50% + ${x})`})`);
  }
  if (shifts.length > 0) style.transform = shifts.join(" ");
  return style;
}

export interface ComponentTreeRendererProps {
  node: ResolvedNode;
  /** The slot's own content, addressed by child id — what a `core` leaf names.
   * An entry absent by its own data condition renders nothing. */
  nodes: Partial<Record<string, ReactNode>>;
  /** The theme the tree belongs to: `image` assets resolve to its own files. */
  themeId: string;
}

export function ComponentTreeRenderer({ node, nodes, themeId }: ComponentTreeRendererProps) {
  if (node.type === "core") {
    const content = nodes[node.ref] ?? null;
    // The slot's own content is already-built JSX, so a positioned child needs
    // an element of its own for the style to land on.
    return node.position === undefined ? (
      <>{content}</>
    ) : (
      <div style={positionStyle(node.position)}>{content}</div>
    );
  }

  if (node.type === "image") {
    return (
      <img
        src={resolveThemeAsset(themeId, node.asset)}
        alt=""
        style={node.position === undefined ? undefined : positionStyle(node.position)}
      />
    );
  }

  const props = containerProps(node);
  const positioned = node.position === undefined ? undefined : positionStyle(node.position);
  // A free-positioned child places itself within its parent's bounds, so the
  // container has to be the containing block for it.
  const hostsPositioned =
    node.position === undefined && node.children.some((child) => child.position !== undefined);
  const style = {
    ...props.style,
    ...(hostsPositioned && { position: "relative" as const }),
    ...positioned,
  };
  return (
    <div {...props} style={Object.keys(style).length === 0 ? undefined : style}>
      {node.children.map((child, index) => (
        <ComponentTreeRenderer key={index} node={child} nodes={nodes} themeId={themeId} />
      ))}
    </div>
  );
}
