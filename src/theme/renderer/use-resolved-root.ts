import { useMemo } from "react";
import { useDevStore } from "@/theme/dev/dev-store";
import { resolveVariant } from "./variant";
import { useViewportWidth } from "./use-viewport-width";
import type { LayoutFile, LayoutNode } from "./types";

/** The root a layout file draws at the current width (§5.2): Dev Mode's picked
 * width, else an explicit width, else the measured viewport. */
export function useResolvedRoot(file: LayoutFile, width?: number): LayoutNode {
  // The selector subscribes so an unrelated dev-store field doesn't re-render
  // the tree; the getState() fallback covers SSR/renderToStaticMarkup, where
  // zustand's server snapshot is frozen at store creation (see FallbackNotice).
  const devWidth = useDevStore((s) => s.variantWidth) ?? useDevStore.getState().variantWidth;
  const viewportWidth = useViewportWidth();
  return useMemo(
    () => resolveVariant(file, devWidth ?? width ?? viewportWidth),
    [file, devWidth, width, viewportWidth],
  );
}
