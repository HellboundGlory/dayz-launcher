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
import { SubjectContextProvider, useElementContext } from "../elements/context";

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
        {renderContainer(node)}
      </SubjectContextProvider>
    );
  }

  return renderContainer(node);
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
