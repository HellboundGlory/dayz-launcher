// The one place a component reaches into the active theme's layout.json.
// Every slot in SLOTS resolves to something even when the active theme has
// no layout.json at all (a preset, or a Basic-tier install) — that default
// case must reproduce today's hardcoded render order exactly, since no
// installed theme can be Advanced-tier yet.
import { useMemo } from "react";
import { useThemeStore } from "./theme-store";
import { resolveLayout, type ResolvedLayout, type ResolvedSlotLayout } from "./layout-store";
import { SLOTS } from "./slots";

const DEFAULT_RESOLVED: ResolvedLayout = resolveLayout(SLOTS, null).resolved;

export function useResolvedLayout(): ResolvedLayout {
  const activeId = useThemeStore((s) => s.activeId);
  const themeFiles = useThemeStore((s) => s.themeFiles);

  return useMemo(() => {
    const layoutJson = themeFiles[activeId]?.layout ?? null;
    if (layoutJson === null) return DEFAULT_RESOLVED;
    const { resolved, issues } = resolveLayout(SLOTS, layoutJson);
    for (const issue of issues) {
      console.warn(`[theme layout] ${issue.slotId}: ${issue.message}`);
    }
    return resolved;
  }, [activeId, themeFiles]);
}

/** A slot's own resolved entry, or an empty default if somehow absent (an id
 * `resolveLayout` doesn't recognise — should not happen for any real entry
 * in SLOTS, but a component must never crash over it). */
export function useResolvedSlot(slotId: string): ResolvedSlotLayout {
  const layout = useResolvedLayout();
  return layout[slotId] ?? { children: [], hidden: [], params: {} };
}
