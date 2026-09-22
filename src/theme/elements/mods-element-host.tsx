import type { CSSProperties, ReactNode } from "react";
import { CheckSquare } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useModsStore, visibleRows } from "@/stores/mods-store";
import type { ElementNode } from "../renderer/types";
import { OptionIcon } from "./option-icon";
import {
  ModCreated,
  ModDescription,
  ModDeselect,
  ModDisabledBadge,
  ModFolder,
  ModName,
  ModNeededBy,
  ModOpenFolder,
  ModOpenInSteam,
  ModPublishedSize,
  ModRating,
  ModReinstall,
  ModSelect,
  ModServerAddress,
  ModServerLastPlayed,
  ModServerName,
  ModSize,
  ModStatus,
  ModSubscribed,
  ModSubscribers,
  ModTags,
  ModThumbnail,
  ModUpdate,
  ModUpdated,
  ModWorkshopId,
} from "./mod-elements";
import { ModsListHost, ModServersListHost } from "./list-elements";
import {
  ModsCleanupRemoved,
  ModsClearSelection,
  ModsCount,
  ModsRefresh,
  ModsSearch,
  ModsSelectUnique,
  ModsStatusFilter,
  ModsUnsubscribe,
  ModsUnsubscribeAll,
  ModsUnsubscribeMenu,
  ModsUnsubscribeSelected,
  ModsUpdateOutdated,
  ModsVerify,
  ModsVerifyAll,
  ModsVerifyMenu,
  ModsVerifySelected,
} from "./mods-toolbar-elements";

/** Checked while every visible mod is checked; options only apply outside a list header. */
function ModsSelectAll({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { rows, selectedIds, setAllSelected } = useModsStore(
    useShallow((s) => ({
      rows: s.rows,
      selectedIds: s.selectedIds,
      setAllSelected: s.setAllSelected,
    })),
  );
  const visible = visibleRows(rows);
  const allSelected = visible.length > 0 && visible.every((r) => selectedIds.has(r.workshop_id));
  const defaultLabel = allSelected ? "Deselect all" : "Select all visible";
  const hasOptions = options?.icon !== undefined || options?.display !== undefined || options?.label !== undefined;

  if (!hasOptions) {
    return (
      <button
        type="button"
        data-el="mods.selectAll"
        aria-pressed={allSelected}
        data-state={allSelected ? "checked" : undefined}
        title={defaultLabel}
        aria-label={defaultLabel}
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

  const label = (options?.label as string | undefined) ?? defaultLabel;
  const display = (options?.display as string | undefined) ?? "iconLabel";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  return (
    <button
      type="button"
      data-el="mods.selectAll"
      aria-pressed={allSelected}
      data-state={allSelected ? "checked" : undefined}
      title={label}
      aria-label={label}
      onClick={() => setAllSelected(!allSelected)}
      className={className ?? "flex items-center gap-1 text-accent hover:text-accent2"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon" className="flex">
          <OptionIcon icon={options?.icon} fallback={CheckSquare} className="size-3.5" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

/** Every `mod.*`, `mods.*` and `list.mods` element; `undefined` for anything else. */
export function renderModsElement(
  node: ElementNode,
  { className, style }: { className?: string; style?: CSSProperties },
): ReactNode | undefined {
  switch (node.element) {
    case "mod.select":
      return <ModSelect className={className} style={style} />;
    case "mod.status":
      return <ModStatus className={className} style={style} />;
    case "mod.thumbnail":
      return <ModThumbnail className={className} style={style} />;
    case "mod.name":
      return <ModName className={className} style={style} />;
    case "mod.disabledBadge":
      return <ModDisabledBadge options={node.options} className={className} style={style} />;
    case "mod.tags":
      return <ModTags options={node.options} className={className} style={style} />;
    case "mod.size":
      return <ModSize className={className} style={style} />;
    case "mod.publishedSize":
      return <ModPublishedSize className={className} style={style} />;
    case "mod.updated":
      return <ModUpdated options={node.options} className={className} style={style} />;
    case "mod.subscribed":
      return <ModSubscribed options={node.options} className={className} style={style} />;
    case "mod.created":
      return <ModCreated options={node.options} className={className} style={style} />;
    case "mod.subscribers":
      return <ModSubscribers className={className} style={style} />;
    case "mod.rating":
      return <ModRating className={className} style={style} />;
    case "mod.workshopId":
      return <ModWorkshopId className={className} style={style} />;
    case "mod.folder":
      return <ModFolder className={className} style={style} />;
    case "mod.description":
      return <ModDescription options={node.options} className={className} style={style} />;
    case "mod.update":
      return <ModUpdate options={node.options} className={className} style={style} />;
    case "mod.openInSteam":
      return <ModOpenInSteam options={node.options} className={className} style={style} />;
    case "mod.openFolder":
      return <ModOpenFolder options={node.options} className={className} style={style} />;
    case "mod.reinstall":
      return <ModReinstall options={node.options} className={className} style={style} />;
    case "mod.deselect":
      return <ModDeselect options={node.options} className={className} style={style} />;
    case "mod.neededBy":
      return <ModNeededBy options={node.options} className={className} style={style} />;
    case "modServer.name":
      return <ModServerName className={className} style={style} />;
    case "modServer.address":
      return <ModServerAddress className={className} style={style} />;
    case "modServer.lastPlayed":
      return <ModServerLastPlayed options={node.options} className={className} style={style} />;
    case "list.mods":
      return <ModsListHost className={className} style={style} />;
    case "list.modServers":
      return <ModServersListHost className={className} style={style} />;
    case "mods.selectAll":
      return <ModsSelectAll options={node.options} className={className} style={style} />;
    case "mods.search":
      return <ModsSearch className={className} style={style} />;
    case "mods.statusFilter":
      return <ModsStatusFilter className={className} style={style} />;
    case "mods.refresh":
      return <ModsRefresh options={node.options} className={className} style={style} />;
    case "mods.count":
      return <ModsCount className={className} style={style} />;
    case "mods.clearSelection":
      return <ModsClearSelection options={node.options} className={className} style={style} />;
    case "mods.cleanupRemoved":
      return <ModsCleanupRemoved options={node.options} className={className} style={style} />;
    case "mods.unsubscribe":
      return <ModsUnsubscribe options={node.options} className={className} style={style} />;
    case "mods.unsubscribeMenu":
      return <ModsUnsubscribeMenu options={node.options} className={className} style={style} />;
    case "mods.unsubscribeSelected":
      return <ModsUnsubscribeSelected options={node.options} className={className} style={style} />;
    case "mods.unsubscribeAll":
      return <ModsUnsubscribeAll options={node.options} className={className} style={style} />;
    case "mods.verify":
      return <ModsVerify options={node.options} className={className} style={style} />;
    case "mods.verifyMenu":
      return <ModsVerifyMenu options={node.options} className={className} style={style} />;
    case "mods.verifySelected":
      return <ModsVerifySelected options={node.options} className={className} style={style} />;
    case "mods.verifyAll":
      return <ModsVerifyAll options={node.options} className={className} style={style} />;
    case "mods.updateOutdated":
      return <ModsUpdateOutdated options={node.options} className={className} style={style} />;
    case "mods.selectUnique":
      return <ModsSelectUnique options={node.options} className={className} style={style} />;
    default:
      return undefined;
  }
}
