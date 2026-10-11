// The recursive node dispatcher. It reads the shared render context (settings,
// outlets, the element host and the theme id), applies the common props every
// node carries — hidden checks, region id, theme classes, landmark tag,
// positioning — and hands off to the right container or leaf.

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { Box, Grid, Scroll, Stack } from "./containers";
import { ImageLeaf, OutletLeaf, TextLeaf } from "./leaves";
import { commonAttrs, isHidden, LANDMARK_TAGS, positionStyle, sizingStyle, withColumn, type SettingsValues } from "./props";
import type { ContainerNode, HostNode, LayoutNode } from "./types";
import { ElementHost } from "../elements/element-host";
import { SurfaceHost } from "../elements/surface-host";
import { SubjectContextProvider, useElementContext, type ElementContextValue } from "../elements/context";
import { Tabs } from "../interaction/tabs";
import { Accordion } from "../interaction/accordion";
import { ResizableHandle, useRegionSize } from "../interaction/resizable";
import { useColumnPlacement } from "../lists/column-context";

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
  const columnStyle = useColumnPlacement(node.column);

  if (isHidden(node.hidden, ctx.settings)) return null;

  if (isHostNode(node)) {
    const sizing = sizingStyle(node);
    const hostStyle = Object.keys(sizing).length > 0 ? sizing : undefined;
    const content =
      ctx.renderElement?.(node) ??
      ("element" in node ? (
        <ElementHost node={node} style={hostStyle} />
      ) : (
        <SurfaceHost node={node} style={hostStyle} />
      ));
    const style: CSSProperties | undefined =
      node.position === undefined && columnStyle === undefined
        ? undefined
        : { ...(node.position !== undefined ? positionStyle(node.position) : undefined), ...columnStyle };
    if (style === undefined) return <>{content}</>;
    return (
      <div
        role={columnStyle !== undefined ? "gridcell" : undefined}
        data-column={columnStyle !== undefined ? node.column : undefined}
        style={style}
      >
        {content}
      </div>
    );
  }

  switch (node.type) {
    case "text":
      return <TextLeaf node={node} attrs={withColumn(commonAttrs(node), columnStyle)} />;
    case "image":
      return <ImageLeaf node={node} themeId={ctx.themeId} attrs={withColumn(commonAttrs(node), columnStyle)} />;
    case "outlet":
      return <OutletLeaf node={node} outlets={ctx.outlets} attrs={withColumn(commonAttrs(node), columnStyle)} />;
    default:
      return <ContainerRenderer node={node} columnStyle={columnStyle} />;
  }
}

function ContainerRenderer({ node, columnStyle }: { node: ContainerNode; columnStyle?: CSSProperties }) {
  const ctx = useContext(RenderContext);
  const elementCtx = useElementContext();
  const [regionSize, setRegionSize] = useRegionSize(node, ctx.themeId);
  const handle = node.resizable ? (
    <ResizableHandle node={node} size={regionSize} onSizeChange={setRegionSize} />
  ) : null;

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
        {renderContainer(node, elementCtx, columnStyle, regionSize, handle)}
      </SubjectContextProvider>
    );
  }

  return renderContainer(node, elementCtx, columnStyle, regionSize, handle);
}

function renderContainer(
  node: ContainerNode,
  elementCtx: ElementContextValue,
  columnStyle: CSSProperties | undefined,
  regionSize: string | undefined,
  handle: ReactNode,
) {
  const hasPositionedChildren =
    "children" in node && Array.isArray(node.children)
      ? node.children.some((child) => child.position !== undefined)
      : false;
  const hostsPositioned = node.position === undefined && hasPositionedChildren;
  const attrs = withColumn(commonAttrs(node, hostsPositioned), columnStyle);
  const As = node.landmark !== undefined ? LANDMARK_TAGS[node.landmark] : "div";
  const regionId = node.id ?? "";

  if (node.resizable && regionId) {
    if (regionSize) {
      const isHoriz = node.resizable.edge === "left" || node.resizable.edge === "right";
      attrs.style = {
        ...attrs.style,
        [isHoriz ? "width" : "height"]: regionSize,
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
    const defaultCollapsed = node.collapsible.default === "collapsed";
    isCollapsed = regionId ? elementCtx.isCollapsed(regionId, defaultCollapsed) : defaultCollapsed;
    attrs["data-state"] = isCollapsed ? "collapsed" : "expanded";
  }

  if (node.collapsible && isCollapsed) {
    const collapsedContent = (
      <>
        <LayoutNodeRenderer node={node.collapsible.collapsed} />
        {handle}
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
        return <As {...attrs}>{collapsedContent}</As>;
    }
  }

  if (node.type === "tabs") {
    return <Tabs node={node} attrs={attrs} as={As} handle={handle} />;
  }

  if (node.type === "accordion") {
    return <Accordion node={node} attrs={attrs} as={As} handle={handle} />;
  }

  const children = (
    <>
      {(node.children ?? []).map((child, index) => (
        <LayoutNodeRenderer key={child.id !== undefined ? `id:${child.id}` : index} node={child} />
      ))}
      {handle}
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
