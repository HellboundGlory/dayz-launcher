// The recursive node dispatcher. It reads the shared render context (settings,
// outlets, the element host and the theme id), applies the common props every
// node carries — hidden checks, region id, theme classes, landmark tag,
// positioning — and hands off to the right container or leaf.

import { createContext, useContext, type ReactNode } from "react";
import { Box, Grid, Scroll, Stack } from "./containers";
import { ImageLeaf, OutletLeaf, TextLeaf } from "./leaves";
import { commonAttrs, isHidden, LANDMARK_TAGS, positionStyle, type SettingsValues } from "./props";
import type { ContainerNode, HostNode, LayoutNode } from "./types";

export interface RenderContextValue {
  settings: SettingsValues;
  outlets: Record<string, ReactNode>;
  renderElement?: (node: HostNode) => ReactNode;
  themeId: string;
}

const RenderContext = createContext<RenderContextValue>({
  settings: {},
  outlets: {},
  themeId: "",
});

export const RenderContextProvider = RenderContext.Provider;

/** Element and surface leaves are launcher-owned; the host renders them. */
function isHostNode(node: LayoutNode): node is HostNode {
  return "element" in node || "surface" in node;
}

export function LayoutNodeRenderer({ node }: { node: LayoutNode }) {
  const ctx = useContext(RenderContext);

  if (isHidden(node.hidden, ctx.settings)) return null;

  if (isHostNode(node)) {
    const content = ctx.renderElement?.(node) ?? null;
    if (node.position === undefined) return <>{content}</>;
    // A positioned host node needs an element of its own for the style to land on.
    return <div style={positionStyle(node.position)}>{content}</div>;
  }

  switch (node.type) {
    case "text":
      return <TextLeaf node={node} attrs={commonAttrs(node)} />;
    case "image":
      return <ImageLeaf node={node} themeId={ctx.themeId} attrs={commonAttrs(node)} />;
    case "outlet":
      return <OutletLeaf node={node} outlets={ctx.outlets} attrs={commonAttrs(node)} />;
    default:
      return renderContainer(node);
  }
}

function renderContainer(node: ContainerNode) {
  const hostsPositioned =
    node.position === undefined && node.children.some((child) => child.position !== undefined);
  const attrs = commonAttrs(node, hostsPositioned);
  const as = node.landmark !== undefined ? LANDMARK_TAGS[node.landmark] : "div";
  const children = node.children.map((child, index) => (
    <LayoutNodeRenderer key={index} node={child} />
  ));

  switch (node.type) {
    case "stack":
      return (
        <Stack node={node} attrs={attrs} as={as}>
          {children}
        </Stack>
      );
    case "grid":
      return (
        <Grid node={node} attrs={attrs} as={as}>
          {children}
        </Grid>
      );
    case "scroll":
      return (
        <Scroll node={node} attrs={attrs} as={as}>
          {children}
        </Scroll>
      );
    case "box":
      return (
        <Box node={node} attrs={attrs} as={as}>
          {children}
        </Box>
      );
  }
}
