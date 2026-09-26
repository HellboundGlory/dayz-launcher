import type { CSSProperties, ReactNode } from "react";
import { REGISTRY } from "../registry";
import { ElementHost } from "./element-host";
import type { SurfaceNode } from "../renderer/types";

export function SurfaceHost({
  node,
  className,
  style,
}: {
  node: SurfaceNode;
  className?: string;
  style?: CSSProperties;
}): ReactNode {
  const surfaceDef = REGISTRY.surfaces[node.surface];
  const mergedClass = [node.class, className].filter(Boolean).join(" ") || undefined;

  if (!surfaceDef) {
    return <div data-surface={node.surface} className={mergedClass} style={style} />;
  }

  return (
    <div data-surface={node.surface} className={mergedClass} style={style}>
      {surfaceDef.contains.map((el) => (
        <ElementHost key={el} node={{ element: el }} />
      ))}
    </div>
  );
}
