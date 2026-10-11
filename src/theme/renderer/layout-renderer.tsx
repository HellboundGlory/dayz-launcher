// The top-level renderer: pick the responsive root for the width, publish the
// render context, and walk the tree.

import { useEffect, useMemo, type ReactNode } from "react";
import { useDevStore } from "@/theme/dev/dev-store";
import { useCollapseRules, type CollapseRules } from "../elements/context";
import { LayoutNodeRenderer, RenderContextProvider } from "./node-renderer";
import type { SettingsValues } from "./props";
import { useResolvedRoot } from "./use-resolved-root";
import type { HostNode, LayoutFile, LayoutNode } from "./types";

/** Registers the collapsible regions of a drawn tree with the element context. */
export function useLayoutCollapseRules(root: LayoutNode) {
  const rules = useMemo(() => collectCollapseRules(root), [root]);
  useCollapseRules(rules);
}

export function collectCollapseRules(node: LayoutNode | undefined, rules: CollapseRules = {}): CollapseRules {
  if (node === undefined) return rules;
  if (node.collapsible !== undefined) {
    const { collapsible } = node;
    const { collapseBelow } = collapsible;
    if (node.id !== undefined) {
      rules[node.id] = {
        defaultCollapsed: collapsible.default === "collapsed",
        collapseBelow: collapseBelow === undefined ? undefined : Number.parseFloat(collapseBelow),
      };
    }
    collectCollapseRules(collapsible.collapsed, rules);
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) collectCollapseRules(child, rules);
  }
  if ("type" in node && node.type === "tabs") {
    for (const tab of node.tabs) {
      collectCollapseRules(tab.label, rules);
      collectCollapseRules(tab.content, rules);
    }
  }
  if ("type" in node && node.type === "accordion") {
    for (const section of node.sections) {
      collectCollapseRules(section.header, rules);
      collectCollapseRules(section.body, rules);
    }
  }
  collectCollapseRules(node.empty, rules);
  return rules;
}

export interface LayoutRendererProps {
  file: LayoutFile;
  /** The window's CSS width, used to pick a variant (§5.2). Defaults to the
   * measured viewport. */
  width?: number;
  outlets?: Record<string, ReactNode>;
  /** Renders an element or surface leaf; supplied by the element host (4.2). */
  renderElement?: (node: HostNode) => ReactNode;
  /** Theme settings the `hidden` conditions read. */
  settings?: SettingsValues;
  /** The theme whose image assets resolve against its own package. */
  themeId?: string;
}

export function LayoutRenderer({
  file,
  width,
  outlets,
  renderElement,
  settings,
  themeId = "",
}: LayoutRendererProps) {
  // Tells the Dev Mode switcher a screen is actually drawing from a layout file.
  useEffect(() => useDevStore.getState().registerRenderer(), []);
  // The selector subscribes so an unrelated dev-store field doesn't re-render
  // the tree; the getState() fallback covers SSR/renderToStaticMarkup, where
  // zustand's server snapshot is frozen at store creation (see FallbackNotice).
  const devSettings = useDevStore((s) => s.settingsOverride) ?? useDevStore.getState().settingsOverride;
  const root = useResolvedRoot(file, width);
  useLayoutCollapseRules(root);
  const value = useMemo(
    () => ({ settings: devSettings ?? settings ?? {}, outlets: outlets ?? {}, renderElement, themeId }),
    [devSettings, settings, outlets, renderElement, themeId],
  );
  return (
    <RenderContextProvider value={value}>
      <LayoutNodeRenderer node={root} />
    </RenderContextProvider>
  );
}
