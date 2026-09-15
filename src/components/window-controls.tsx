import { Fragment, useMemo, type ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useResolvedSlot } from "@/theme/use-resolved-layout";
import { resolveComponentTree } from "@/theme/component-tree";
import { ComponentTreeRenderer } from "@/theme/component-tree-renderer";
import { SLOTS } from "@/theme/slots";
import { useThemeStore } from "@/theme/theme-store";

/** `shell.header`'s registry entry — the children a theme's tree resolves against. */
const HEADER_CHILDREN = SLOTS.find((slot) => slot.id === "shell.header")?.children ?? [];

// The frameless window's min/max/close cluster — needed since decorations:
// false leaves no OS-provided way to close the window. Also doubles as the drag region.
export function WindowControls() {
  const slot = useResolvedSlot("shell.header");
  const hidden = new Set(slot.hidden);
  const dragHidden = hidden.has("dragRegion");

  // An expert theme's own composition for this slot, when it ships one. A
  // theme with no tree renders the default cluster exactly as it always has.
  const activeId = useThemeStore((s) => s.activeId);
  const themeFiles = useThemeStore((s) => s.themeFiles);
  const composition = useMemo(() => {
    const theme = themeFiles[activeId];
    if (theme === undefined || theme.tier !== "expert") return null;
    const treeJson = theme.components["shell.header"];
    if (treeJson === undefined) return null;
    const { tree, issues } = resolveComponentTree("shell.header", treeJson, HEADER_CHILDREN);
    for (const issue of issues) {
      console.warn(`[theme components] ${issue.slotId}: ${issue.message}`);
    }
    return tree;
  }, [activeId, themeFiles]);

  function minimizeWindow() {
    getCurrentWindow()
      .minimize()
      .catch(() => {});
  }
  function maximizeWindow() {
    getCurrentWindow()
      .toggleMaximize()
      .catch(() => {});
  }
  function closeWindow() {
    getCurrentWindow()
      .close()
      .catch(() => {});
  }

  // One registry id covers the whole cluster, not one per button.
  const windowControls = (
    <Fragment>
      <button
        onClick={minimizeWindow}
        title="Minimize"
        aria-label="Minimize"
        data-tetra-el="windowControls"
        className="inline-flex h-7 w-[40px] items-center justify-center text-muted transition-colors hover:bg-surface2 hover:text-ink"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={maximizeWindow}
        title="Maximize"
        aria-label="Maximize"
        data-tetra-el="windowControls"
        className="inline-flex h-7 w-[40px] items-center justify-center text-muted transition-colors hover:bg-surface2 hover:text-ink"
      >
        <Square className="size-3" />
      </button>
      <button
        onClick={closeWindow}
        title="Close"
        aria-label="Close"
        data-tetra-el="windowControls"
        className="inline-flex h-7 w-[40px] items-center justify-center text-muted transition-colors hover:bg-danger hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </Fragment>
  );

  const nodes: Record<string, ReactNode> = {
    windowControls,
    dragRegion: (
      <div
        data-tetra-el="dragRegion"
        data-tauri-drag-region
        className="flex h-7 shrink-0 select-none items-center justify-end border-b border-line bg-surface"
      >
        {windowControls}
      </div>
    ),
  };

  // The container is the slot and the drag region in one element; hiding the
  // optional child drops its tags, not the bar itself.
  return (
    <div
      data-tetra-slot="shell.header"
      data-tetra-el={dragHidden ? undefined : "dragRegion"}
      data-tauri-drag-region={dragHidden ? undefined : true}
      className="flex h-7 shrink-0 select-none items-center justify-end border-b border-line bg-surface"
    >
      {composition !== null ? (
        <ComponentTreeRenderer node={composition} nodes={nodes} themeId={activeId} />
      ) : (
        windowControls
      )}
    </div>
  );
}
