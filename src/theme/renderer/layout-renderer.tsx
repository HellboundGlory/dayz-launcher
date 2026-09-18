// The top-level renderer: pick the responsive root for the width, publish the
// render context, and walk the tree.

import { useMemo, type ReactNode } from "react";
import { useDevStore } from "@/theme/dev/dev-store";
import { LayoutNodeRenderer, RenderContextProvider } from "./node-renderer";
import type { SettingsValues } from "./props";
import { resolveVariant } from "./variant";
import type { HostNode, LayoutFile } from "./types";

export interface LayoutRendererProps {
  file: LayoutFile;
  /** The window's CSS width, used to pick a variant (§5.2). */
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
  width = 0,
  outlets,
  renderElement,
  settings,
  themeId = "",
}: LayoutRendererProps) {
  // The selector subscribes so an unrelated dev-store field doesn't re-render
  // the tree; the getState() fallback covers SSR/renderToStaticMarkup, where
  // zustand's server snapshot is frozen at store creation (see FallbackNotice).
  const devWidth = useDevStore((s) => s.variantWidth) ?? useDevStore.getState().variantWidth;
  const devSettings = useDevStore((s) => s.settingsOverride) ?? useDevStore.getState().settingsOverride;
  const root = useMemo(() => resolveVariant(file, devWidth ?? width), [file, devWidth, width]);
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
