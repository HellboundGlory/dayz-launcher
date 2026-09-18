// The recursive node dispatcher. It reads the shared render context (settings,
// outlets, the element host and the theme id), applies the common props every
// node carries — hidden checks, region id, theme classes, landmark tag,
// positioning — and hands off to the right container or leaf.

import { createContext, useContext, type ReactNode } from "react";
import { Box, Grid, Scroll, Stack } from "./containers";
import { ImageLeaf, OutletLeaf, TextLeaf } from "./leaves";
import { commonAttrs, isHidden, LANDMARK_TAGS, positionStyle, type SettingsValues } from "./props";
import type { ContainerNode, HostNode, LayoutNode } from "./types";
import { ElementHost } from "../elements/element-host";
import { SurfaceHost } from "../elements/surface-host";
import { SubjectContextProvider, useElementContext, type ElementContextValue } from "../elements/context";
import { Tabs } from "../interaction/tabs";
import { Accordion } from "../interaction/accordion";
import { ResizableHandle } from "../interaction/resizable";
import { getPersistedCollapsed, getPersistedSize } from "../interaction/store";

export interface RenderContextValue {
  settings: SettingsValues;
  outlets: Record<string, ReactNode>;
  renderElement?: (node: HostNode) => ReactNode;
  themeId: string;
}

export const RenderContext = createContext<RenderContextValue>({
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
    const content =
      ctx.renderElement?.(node) ??
      ("element" in node ? (
        <ElementHost node={node} />
      ) : (
        <SurfaceHost node={node} />
      ));
    if (node.position === undefined) return <>{content}</>;
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
      return <ContainerRenderer node={node} />;
  }
}

function ContainerRenderer({ node }: { node: ContainerNode }) {
  const ctx = useContext(RenderContext);
  const elementCtx = useElementContext();

  if (node.context !== undefined) {
    let subjectData: unknown = null;
    let subjectKind: "server" | "mod" | "workshopMod" = "server";

    if (node.context === "selection") {
      subjectData = elementCtx.selectedServer;
      subjectKind = "server";
    } else if (node.context === "modSelection") {
      subjectData = elementCtx.selectedMod;
      subjectKind = "mod";
    } else if (node.context === "modFilterPreview") {
      subjectData = elementCtx.previewMod;
      subjectKind = "workshopMod";
    }

    if (!subjectData) {
      if (node.empty) {
        return <LayoutNodeRenderer node={node.empty} />;
      }
      return null;
    }

    return (
      <SubjectContextProvider
        subject={{ kind: subjectKind, data: subjectData }}
        contextName={node.context}
      >
        {renderContainer(node, ctx, elementCtx)}
      </SubjectContextProvider>
    );
  }

  return renderContainer(node, ctx, elementCtx);
}

function renderContainer(
  node: ContainerNode,
  ctx: RenderContextValue,
  elementCtx: ElementContextValue,
) {
  const hasPositionedChildren =
    "children" in node && Array.isArray(node.children)
      ? node.children.some((child) => child.position !== undefined)
      : false;
  const hostsPositioned = node.position === undefined && hasPositionedChildren;
  const attrs = commonAttrs(node, hostsPositioned);
  const As = node.landmark !== undefined ? LANDMARK_TAGS[node.landmark] : "div";
  const regionId = node.id ?? "";

  if (node.resizable && regionId) {
    const persistedSize = getPersistedSize(ctx.themeId, regionId);
    if (persistedSize) {
      const isHoriz = node.resizable.edge === "left" || node.resizable.edge === "right";
      attrs.style = {
        ...attrs.style,
        [isHoriz ? "width" : "height"]: persistedSize,
      };
    }
    if (attrs.style?.position === undefined) {
      attrs.style = {
        ...attrs.style,
        position: "relative",
      };
    }
  }

  let isCollapsed = false;
  if (node.collapsible) {
    if (regionId && elementCtx.collapsedRegions[regionId] !== undefined) {
      isCollapsed = elementCtx.collapsedRegions[regionId];
    } else if (regionId) {
      const defaultCollapsed = node.collapsible.default === "collapsed";
      isCollapsed = getPersistedCollapsed(ctx.themeId, regionId, defaultCollapsed);
    } else {
      isCollapsed = node.collapsible.default === "collapsed";
    }
    attrs["data-state"] = isCollapsed ? "collapsed" : "expanded";
  }

  if (node.collapsible && isCollapsed) {
    const collapsedContent = (
      <>
        <LayoutNodeRenderer node={node.collapsible.collapsed} />
        {node.resizable && <ResizableHandle node={node} />}
      </>
    );

    switch (node.type) {
      case "stack":
        return <Stack node={node} attrs={attrs} as={As}>{collapsedContent}</Stack>;
      case "grid":
        return <Grid node={node} attrs={attrs} as={As}>{collapsedContent}</Grid>;
      case "scroll":
        return <Scroll node={node} attrs={attrs} as={As}>{collapsedContent}</Scroll>;
      case "box":
        return <Box node={node} attrs={attrs} as={As}>{collapsedContent}</Box>;
      default:
        return (
          <As id={attrs.id} className={attrs.className} style={attrs.style} data-state={attrs["data-state"]}>
            {collapsedContent}
          </As>
        );
    }
  }

  if (node.type === "tabs") {
    return <Tabs node={node} attrs={attrs} as={As} />;
  }

  if (node.type === "accordion") {
    return <Accordion node={node} attrs={attrs} as={As} />;
  }

  const children = (
    <>
      {node.children.map((child, index) => (
        <LayoutNodeRenderer key={index} node={child} />
      ))}
      {node.resizable && <ResizableHandle node={node} />}
    </>
  );

  switch (node.type) {
    case "stack":
      return (
        <Stack node={node} attrs={attrs} as={As}>
          {children}
        </Stack>
      );
    case "grid":
      return (
        <Grid node={node} attrs={attrs} as={As}>
          {children}
        </Grid>
      );
    case "scroll":
      return (
        <Scroll node={node} attrs={attrs} as={As}>
          {children}
        </Scroll>
      );
    case "box":
      return (
        <Box node={node} attrs={attrs} as={As}>
          {children}
        </Box>
      );
  }

}
