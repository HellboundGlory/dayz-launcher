// Shared Expert-tier composition resolution — every composed slot's call site
// used to hand-roll this same block. Centralizing it here is also where
// `compositionCeiling` actually gets enforced: a capped slot never composes,
// no matter what a theme ships, instead of relying on no call site existing
// for it yet.
import { useMemo } from "react";
import { useThemeStore } from "./theme-store";
import { resolveComponentTree, type ResolvedNode } from "./component-tree";
import { SLOTS } from "./slots";

/** Whether `compositionCeiling` caps this slot below Expert, regardless of
 * the active theme's own tier. */
export function isCompositionCapped(slotId: string): boolean {
  return SLOTS.find((slot) => slot.id === slotId)?.compositionCeiling === "advanced";
}

export function useComponentComposition(slotId: string): ResolvedNode | null {
  const activeId = useThemeStore((s) => s.activeId);
  const themeFiles = useThemeStore((s) => s.themeFiles);
  return useMemo(() => {
    if (isCompositionCapped(slotId)) return null;
    const theme = themeFiles[activeId];
    if (theme === undefined || theme.tier !== "expert") return null;
    const treeJson = theme.components[slotId];
    if (treeJson === undefined) return null;
    const slot = SLOTS.find((s) => s.id === slotId);
    const { tree, issues } = resolveComponentTree(slotId, treeJson, slot?.children ?? []);
    for (const issue of issues) {
      console.warn(`[theme components] ${issue.slotId}: ${issue.message}`);
    }
    return tree;
  }, [activeId, themeFiles, slotId]);
}
