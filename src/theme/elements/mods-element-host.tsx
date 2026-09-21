import type { CSSProperties, ReactNode } from "react";
import { CheckSquare } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useModsStore, visibleRows } from "@/stores/mods-store";
import type { ElementNode } from "../renderer/types";
import { ModActions, ModAuthor, ModName, ModSize, ModStatus, ModSubscribed, ModUpdated } from "./mod-elements";
import { ModsListHost } from "./list-elements";

/** Checked while every visible mod is checked; a click checks or clears them all. */
function ModsSelectAll({ className, style }: { className?: string; style?: CSSProperties }) {
  const { rows, selectedIds, setAllSelected } = useModsStore(
    useShallow((s) => ({
      rows: s.rows,
      selectedIds: s.selectedIds,
      setAllSelected: s.setAllSelected,
    })),
  );
  const visible = visibleRows(rows);
  const allSelected = visible.length > 0 && visible.every((r) => selectedIds.has(r.workshop_id));

  return (
    <button
      type="button"
      data-el="mods.selectAll"
      aria-pressed={allSelected}
      data-state={allSelected ? "checked" : undefined}
      title={allSelected ? "Deselect all" : "Select all visible"}
      aria-label={allSelected ? "Deselect all" : "Select all visible"}
      onClick={() => setAllSelected(!allSelected)}
      className={className ?? "flex items-center justify-center text-accent hover:text-accent2"}
      style={style}
    >
      <span data-part="icon" className="flex">
        {allSelected ? (
          <CheckSquare className="size-3.5" />
        ) : (
          <span className="size-3.5 [border-radius:var(--t-radius-badge)] border border-line" />
        )}
      </span>
    </button>
  );
}

/** Every `mod.*`, `mods.*` and `list.mods` element; `undefined` for anything else. */
export function renderModsElement(
  node: ElementNode,
  { className, style }: { className?: string; style?: CSSProperties },
): ReactNode | undefined {
  switch (node.element) {
    case "mod.name":
      return <ModName className={className} style={style} />;
    case "mod.status":
      return <ModStatus className={className} style={style} />;
    case "mod.size":
      return <ModSize className={className} style={style} />;
    case "mod.updated":
      return <ModUpdated className={className} style={style} />;
    case "mod.actions":
      return <ModActions className={className} style={style} />;
    case "mod.author":
      return <ModAuthor className={className} style={style} />;
    case "mod.subscribed":
      return <ModSubscribed className={className} style={style} />;
    case "list.mods":
      return <ModsListHost className={className} style={style} />;
    case "mods.selectAll":
      return <ModsSelectAll className={className} style={style} />;
    default:
      return undefined;
  }
}
