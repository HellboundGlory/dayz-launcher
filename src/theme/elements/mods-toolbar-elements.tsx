import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChevronDown,
  Download,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useModsStore, visibleRows, type ModStatusFilter } from "@/stores/mods-store";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { getThemeOwnedLayout, useLayoutSubscription } from "../theme-store";
import type { PopupLayoutFile } from "../renderer/types";
import { FilterPopup, UniqueServerOptionsList, useTriggerRect } from "./popup-elements";
import { OptionIcon } from "./option-icon";

function toolbarDisplayOptions(
  options: Record<string, unknown> | undefined,
  fallbackLabel: string,
  defaultDisplay: "iconLabel" | "label" | "icon",
) {
  const display = (options?.display as string | undefined) ?? defaultDisplay;
  const label = (options?.label as string | undefined) ?? fallbackLabel;
  return {
    label,
    showIcon: display === "iconLabel" || display === "icon",
    showLabel: display === "iconLabel" || display === "label",
  };
}

const STATUS_FILTERS: { key: ModStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "outdated", label: "Outdated" },
  { key: "downloading", label: "Downloading" },
];

function statesAttr(...vals: (string | false | undefined)[]): string | undefined {
  const s = vals.filter(Boolean).join(" ");
  return s || undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Outside-mousedown/Escape close, same pattern as `filter-elements.tsx`'s dropdowns. */
function useModsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { open, setOpen, ref };
}

export function ModsSearch({ className, style }: { className?: string; style?: CSSProperties }) {
  const search = useModsStore((s) => s.search);
  const setSearch = useModsStore((s) => s.setSearch);

  const filled = search.trim().length > 0;

  return (
    <div
      data-el="mods.search"
      data-state={filled ? "filled" : undefined}
      className={className ?? "flex min-w-0 flex-1 items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-[5px]"}
      style={style}
    >
      <span data-part="icon" className="flex shrink-0">
        <Search className="size-3 text-muted" />
      </span>
      <input
        data-part="input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search mods by name, tag or id..."
        aria-label="Search mods"
        className="min-w-0 flex-1 bg-transparent py-0.5 [font-size:var(--t-type-body-size)] text-ink outline-none placeholder:text-muted"
      />
    </div>
  );
}

export function ModsStatusFilter({ className, style }: { className?: string; style?: CSSProperties }) {
  const statusFilter = useModsStore((s) => s.statusFilter);
  const setStatusFilter = useModsStore((s) => s.setStatusFilter);

  return (
    <div data-el="mods.statusFilter" className={className ?? "flex items-center gap-0.5"} style={style}>
      {STATUS_FILTERS.map((f) => {
        const selected = statusFilter === f.key;
        return (
          <button
            key={f.key}
            type="button"
            data-part="option"
            data-state={selected ? "selected" : undefined}
            aria-pressed={selected}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "flex items-center justify-center [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-[5px] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider transition-colors",
              selected ? "border-accent-line bg-accent-soft text-accent" : "text-muted hover:text-ink",
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

export function ModsRefresh({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const loading = useModsStore((s) => s.loading);
  const op = useModsStore((s) => s.op);
  const load = useModsStore((s) => s.load);
  const busy = loading || !!op;
  const { label, showIcon, showLabel } = toolbarDisplayOptions(options, "Refresh", "iconLabel");

  return (
    <button
      type="button"
      data-el="mods.refresh"
      data-state={loading ? "busy" : undefined}
      onClick={() => void load(true)}
      disabled={busy}
      title="Re-read the list and refresh details from the Workshop"
      className={className ?? "flex shrink-0 items-center gap-1 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2 py-[5px] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon" className="flex">
          <OptionIcon icon={options?.icon} fallback={RefreshCw} className={cn("size-3", loading && "animate-spin")} />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ModsCount({ className, style }: { className?: string; style?: CSSProperties }) {
  const { rows, selectedIds } = useModsStore(
    useShallow((s) => ({ rows: s.rows, selectedIds: s.selectedIds })),
  );
  const allCount = visibleRows(rows).length;
  const selectedCount = selectedIds.size;
  const selecting = selectedCount > 0;

  return (
    <span
      data-el="mods.count"
      data-state={selecting ? "selecting" : undefined}
      className={className ?? "shrink-0 [font-size:var(--t-type-label-size)] tabular-nums text-muted"}
      style={style}
    >
      {selecting ? (
        <>
          <span data-part="value" className="font-semibold text-ink">
            {selectedCount}
          </span>{" "}
          <span data-part="label">of {allCount} selected</span>
        </>
      ) : (
        <>
          <span data-part="value" className="font-semibold text-ink">
            {allCount}
          </span>{" "}
          <span data-part="label">mod{allCount === 1 ? "" : "s"}</span>
        </>
      )}
    </span>
  );
}

export function ModsClearSelection({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const selectedCount = useModsStore((s) => s.selectedIds.size);
  const clearSelection = useModsStore((s) => s.clearSelection);
  const { label, showIcon, showLabel } = toolbarDisplayOptions(options, "Clear", "label");

  return (
    <button
      type="button"
      data-el="mods.clearSelection"
      onClick={() => clearSelection()}
      disabled={selectedCount === 0}
      className={className ?? "shrink-0 [font-size:var(--t-type-caption-size)] font-bold uppercase tracking-[0.06em] text-muted transition-colors hover:text-ink disabled:opacity-40"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={X} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ModsCleanupRemoved({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const rows = useModsStore((s) => s.rows);
  const op = useModsStore((s) => s.op);
  const cleanupRemoved = useModsStore((s) => s.cleanupRemoved);
  const askConfirm = useConfirm();
  const removedCount = rows.filter((r) => r.removed).length;
  const busy = !!op;
  const baseLabel = (options?.label as string | undefined) ?? "Clean up";
  const display = (options?.display as string | undefined) ?? "iconLabel";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  if (removedCount === 0) return null;

  return (
    <button
      type="button"
      data-el="mods.cleanupRemoved"
      data-state={busy ? "disabled" : undefined}
      onClick={() =>
        askConfirm(
          "Clean up removed mods",
          `${removedCount} subscribed item${removedCount === 1 ? " is" : "s are"} no longer on the Workshop. ` +
            "Steam will remove them from your subscriptions and delete their folders from disk.",
          () => void cleanupRemoved(),
        )
      }
      disabled={busy}
      title={`${removedCount} subscribed item${removedCount === 1 ? " is" : "s are"} no longer on the Workshop`}
      className={className ?? "flex items-center gap-1 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2 py-[5px] [font-size:var(--t-type-micro-size)] font-bold uppercase tracking-[0.04em] text-warn transition-[filter] hover:brightness-110 disabled:opacity-50"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon" className="flex">
          <OptionIcon icon={options?.icon} fallback={Trash2} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{baseLabel} {removedCount}</span>}
    </button>
  );
}

interface MenuItemProps {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
  /** Closes the owning trigger's popup; only set when rendered as a menu item. */
  onDone?: () => void;
}

const MENU_ITEM_CLASS =
  "flex w-full items-center [border-radius:var(--t-radius-controlCompact)] px-3 py-2 text-left [font-size:var(--t-type-body-size)] font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40";

const UNSUBSCRIBE_MESSAGE =
  "Steam deletes the mod files from disk, and Workshop mods are shared — " +
  "every server that uses them will have to download them again when you join.";

export function ModsUnsubscribe({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const { selectedCount, op, unsubscribeSelected } = useModsStore(
    useShallow((s) => ({ selectedCount: s.selectedIds.size, op: s.op, unsubscribeSelected: s.unsubscribeSelected })),
  );
  const askConfirm = useConfirm();
  const display = (options?.display as string) ?? "iconLabel";
  const baseLabel = (options?.label as string) ?? "Unsubscribe";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";
  const busy = op?.kind === "unsubscribe";
  const disabled = !!op || selectedCount === 0;
  const labelText = busy ? op?.note ?? "Removing…" : selectedCount > 0 ? `${baseLabel} ${selectedCount}` : baseLabel;

  function handleClick() {
    if (selectedCount === 0) return;
    askConfirm(
      `Unsubscribe from ${selectedCount} mod${selectedCount === 1 ? "" : "s"}`,
      UNSUBSCRIBE_MESSAGE,
      () => void unsubscribeSelected(),
    );
  }

  return (
    <button
      type="button"
      data-el="mods.unsubscribe"
      data-state={statesAttr(busy && "busy", disabled && "disabled")}
      onClick={handleClick}
      disabled={disabled}
      title="Unsubscribe from the selected mods (Steam deletes them from disk)"
      className={
        className ??
        cn(
          "flex items-center justify-center gap-1.5 [border-top-left-radius:var(--t-radius-control)] [border-bottom-left-radius:var(--t-radius-control)] border border-danger-line bg-danger-soft px-3 py-[7px] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-danger transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40",
          busy && "animate-pulse",
        )
      }
      style={style}
    >
      {showIcon && (
        <span data-part="icon" className="flex">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={Trash2} className="size-3" />}
        </span>
      )}
      {showLabel && <span data-part="label">{labelText}</span>}
    </button>
  );
}

export function ModsUnsubscribeSelected({ options, className, style, onDone }: MenuItemProps) {
  const { selectedCount, unsubscribeSelected } = useModsStore(
    useShallow((s) => ({ selectedCount: s.selectedIds.size, unsubscribeSelected: s.unsubscribeSelected })),
  );
  const askConfirm = useConfirm();
  const baseLabel = (options?.label as string) ?? "Unsubscribe selected";
  const label = selectedCount > 0 ? `${baseLabel} (${selectedCount})` : baseLabel;
  const disabled = selectedCount === 0;

  function handleClick() {
    if (disabled) return;
    onDone?.();
    askConfirm(
      `Unsubscribe from ${selectedCount} mod${selectedCount === 1 ? "" : "s"}`,
      UNSUBSCRIBE_MESSAGE,
      () => void unsubscribeSelected(),
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      data-el="mods.unsubscribeSelected"
      data-state={disabled ? "disabled" : undefined}
      disabled={disabled}
      onClick={handleClick}
      className={className ?? MENU_ITEM_CLASS}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

export function ModsUnsubscribeAll({ options, className, style, onDone }: MenuItemProps) {
  const { allCount, unsubscribeAll } = useModsStore(
    useShallow((s) => ({ allCount: visibleRows(s.rows).length, unsubscribeAll: s.unsubscribeAll })),
  );
  const askConfirm = useConfirm();
  const baseLabel = (options?.label as string) ?? "Unsubscribe from all";
  const label = `${baseLabel} ${allCount} (destructive)`;
  const disabled = allCount === 0;

  function handleClick() {
    if (disabled) return;
    onDone?.();
    askConfirm(
      `Unsubscribe from all ${allCount} mods`,
      "Every subscribed mod will be removed and its files deleted from disk. " +
        "Servers that need them will re-download them when you join.",
      () => void unsubscribeAll(),
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      data-el="mods.unsubscribeAll"
      data-state={disabled ? "disabled" : undefined}
      disabled={disabled}
      onClick={handleClick}
      className={className ?? MENU_ITEM_CLASS}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

export function ModsUnsubscribeMenu({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const op = useModsStore((s) => s.op);
  const { open, setOpen, ref } = useModsMenu();
  const busy = !!op;

  return (
    <div
      ref={ref}
      data-el="mods.unsubscribeMenu"
      data-state={statesAttr(open && "open", busy && "disabled")}
      className={cn("relative", className ?? "flex items-center justify-center [border-top-right-radius:var(--t-radius-control)] [border-bottom-right-radius:var(--t-radius-control)] border border-l-0 border-danger-line bg-danger-soft px-1.5 text-danger transition-colors hover:brightness-110 data-[state~=disabled]:opacity-40")}
      style={style}
    >
      <button
        type="button"
        data-part="trigger"
        onClick={() => setOpen(!open)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-full w-full items-center justify-center gap-1 border-0 bg-transparent p-0 [font:inherit] [color:inherit] disabled:cursor-not-allowed"
      >
        <span data-part="icon" className="flex">
          <OptionIcon icon={options?.icon} fallback={ChevronDown} className={cn("size-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div
          data-part="popup"
          role="menu"
          className="absolute bottom-full right-0 mb-1 w-56 [border-radius:var(--t-radius-popup)] border border-line bg-surface2 p-1 [box-shadow:var(--t-shadow-popup)]"
        >
          <ModsUnsubscribeSelected onDone={() => setOpen(false)} />
          <ModsUnsubscribeAll onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

export function ModsVerify({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const { selectedCount, allCount, op, verifySelected, verifyAll } = useModsStore(
    useShallow((s) => ({
      selectedCount: s.selectedIds.size,
      allCount: visibleRows(s.rows).length,
      op: s.op,
      verifySelected: s.verifySelected,
      verifyAll: s.verifyAll,
    })),
  );
  const display = (options?.display as string) ?? "iconLabel";
  const baseLabel = (options?.label as string) ?? "Verify mods";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";
  const busy = op?.kind === "verify";
  const disabled = !!op || allCount === 0;
  const labelText = busy ? op?.note ?? "Verifying…" : baseLabel;

  function handleClick() {
    if (selectedCount > 0) void verifySelected();
    else void verifyAll();
  }

  return (
    <button
      type="button"
      data-el="mods.verify"
      data-state={busy ? "busy" : undefined}
      onClick={handleClick}
      disabled={disabled}
      title="Verify every mod against the Workshop and re-download anything outdated"
      className={
        className ??
        cn(
          "flex items-center justify-center gap-1.5 [border-top-left-radius:var(--t-radius-control)] [border-bottom-left-radius:var(--t-radius-control)] bg-accent px-3 py-[7px] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider [color:var(--t-color-onAccent)] [box-shadow:var(--t-shadow-glow)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
          busy && "animate-pulse",
        )
      }
      style={style}
    >
      {showIcon && (
        <span data-part="icon" className="flex">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={Globe} className="size-3" />}
        </span>
      )}
      {showLabel && <span data-part="label">{labelText}</span>}
    </button>
  );
}

export function ModsVerifySelected({ options, className, style, onDone }: MenuItemProps) {
  const { selectedCount, verifySelected } = useModsStore(
    useShallow((s) => ({ selectedCount: s.selectedIds.size, verifySelected: s.verifySelected })),
  );
  const baseLabel = (options?.label as string) ?? "Verify selected";
  const label = selectedCount > 0 ? `${baseLabel} (${selectedCount})` : baseLabel;
  const disabled = selectedCount === 0;

  function handleClick() {
    if (disabled) return;
    onDone?.();
    void verifySelected();
  }

  return (
    <button
      type="button"
      role="menuitem"
      data-el="mods.verifySelected"
      data-state={disabled ? "disabled" : undefined}
      disabled={disabled}
      onClick={handleClick}
      className={className ?? MENU_ITEM_CLASS}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

export function ModsVerifyAll({ options, className, style, onDone }: MenuItemProps) {
  const { allCount, verifyAll } = useModsStore(
    useShallow((s) => ({ allCount: visibleRows(s.rows).length, verifyAll: s.verifyAll })),
  );
  const baseLabel = (options?.label as string) ?? "Verify all";
  const label = `${baseLabel} (${allCount})`;
  const disabled = allCount === 0;

  function handleClick() {
    if (disabled) return;
    onDone?.();
    void verifyAll();
  }

  return (
    <button
      type="button"
      role="menuitem"
      data-el="mods.verifyAll"
      disabled={disabled}
      onClick={handleClick}
      className={className ?? MENU_ITEM_CLASS}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

export function ModsVerifyMenu({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const op = useModsStore((s) => s.op);
  const { open, setOpen, ref } = useModsMenu();
  const busy = !!op;

  return (
    <div
      ref={ref}
      data-el="mods.verifyMenu"
      data-state={statesAttr(open && "open", busy && "disabled")}
      className={cn("relative", className ?? "flex items-center justify-center [border-top-right-radius:var(--t-radius-control)] [border-bottom-right-radius:var(--t-radius-control)] bg-accent px-1.5 [color:var(--t-color-onAccent)] [box-shadow:var(--t-shadow-glow)] transition-colors hover:brightness-110 data-[state~=disabled]:opacity-50")}
      style={style}
    >
      <button
        type="button"
        data-part="trigger"
        onClick={() => setOpen(!open)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-full w-full items-center justify-center gap-1 border-0 bg-transparent p-0 [font:inherit] [color:inherit] disabled:cursor-not-allowed"
      >
        <span data-part="icon" className="flex">
          <OptionIcon icon={options?.icon} fallback={ChevronDown} className={cn("size-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div
          data-part="popup"
          role="menu"
          className="absolute bottom-full right-0 mb-1 w-56 [border-radius:var(--t-radius-popup)] border border-line bg-surface2 p-1 [box-shadow:var(--t-shadow-popup)]"
        >
          <ModsVerifySelected onDone={() => setOpen(false)} />
          <ModsVerifyAll onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

export function ModsUpdateOutdated({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const { outdatedCount, op, updateAllOutdated } = useModsStore(
    useShallow((s) => ({
      outdatedCount: visibleRows(s.rows).filter((r) => r.state === "needs_update").length,
      op: s.op,
      updateAllOutdated: s.updateAllOutdated,
    })),
  );
  const display = (options?.display as string) ?? "iconLabel";
  const baseLabel = (options?.label as string) ?? "Update";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";
  const busy = op?.kind === "update";
  const disabled = !!op || outdatedCount === 0;
  const labelText = busy ? op?.note ?? "Updating…" : `${baseLabel} ${outdatedCount} outdated`;

  return (
    <button
      type="button"
      data-el="mods.updateOutdated"
      data-state={disabled ? "disabled" : undefined}
      onClick={() => void updateAllOutdated()}
      disabled={disabled}
      title={`Download the newer Workshop copy of ${outdatedCount} mod${outdatedCount === 1 ? "" : "s"}`}
      className={
        className ??
        cn(
          "flex shrink-0 items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-warn-line bg-warn-soft px-2.5 py-[7px] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-warn transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
          busy && "animate-pulse",
        )
      }
      style={style}
    >
      {showIcon && (
        <span data-part="icon" className="flex">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={Download} className="size-3" />}
        </span>
      )}
      {showLabel && <span data-part="label">{labelText}</span>}
    </button>
  );
}

/** The select-unique dropdown's body, taken as props so it's directly testable (mirrors `ServerLoadMenuPopup`). */
export function ModsSelectUniquePopup({
  open,
  caredServers,
  onSelect,
}: {
  open: boolean;
  caredServers: { addr: string; query_port: number; name: string }[];
  onSelect: (addr: string, queryPort: number, name: string) => void;
}) {
  if (!open) return null;
  return (
    <div
      data-part="popup"
      role="menu"
      className="absolute bottom-full left-0 mb-1 max-h-64 w-80 overflow-y-auto [border-radius:var(--t-radius-popup)] border border-line bg-surface2 p-1 [box-shadow:var(--t-shadow-popup)]"
    >
      <UniqueServerOptionsList caredServers={caredServers} onSelect={onSelect} />
    </div>
  );
}

export function ModsSelectUnique({ options, className, style }: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  const { caredServers, uniqueSource, selectUniqueTo } = useModsStore(
    useShallow((s) => ({ caredServers: s.caredServers, uniqueSource: s.uniqueSource, selectUniqueTo: s.selectUniqueTo })),
  );
  const { open, setOpen, ref } = useModsMenu();
  const baseLabel = (options?.label as string) ?? "Select unique…";
  const disabled = caredServers.length === 0;
  useLayoutSubscription();
  const themedPopup = getThemeOwnedLayout("layout/popups/modsUnique.json") as PopupLayoutFile | undefined;
  const triggerRect = useTriggerRect(ref, open && !!themedPopup);

  return (
    <div
      ref={ref}
      data-el="mods.selectUnique"
      data-state={statesAttr(open && "open", disabled && "disabled")}
      className={cn(
        "relative",
        className ??
          "flex items-center [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2 py-[5px] [font-size:var(--t-type-micro-size)] font-bold uppercase tracking-[0.04em] text-muted2 transition-colors hover:text-ink",
        disabled && "opacity-50",
      )}
      style={style}
    >
      <button
        type="button"
        data-part="trigger"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Select the mods only one server uses, in case you want to prune it"
        className="flex h-full w-full items-center justify-center gap-1 border-0 bg-transparent p-0 [font:inherit] [color:inherit] disabled:cursor-not-allowed"
      >
        <span data-part="icon" className="flex">
          <Star className="size-3" />
        </span>
        {uniqueSource ? (
          <span data-part="value">Unique: {truncate(uniqueSource, 24)}</span>
        ) : (
          <span data-part="label">{baseLabel}</span>
        )}
        <span data-part="chevron" className="flex">
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      <FilterPopup
        open={open}
        popupId="modsUnique"
        close={() => setOpen(false)}
        themedPopup={themedPopup}
        triggerRect={triggerRect}
        triggerRef={ref}
      >
        <ModsSelectUniquePopup
          open={open}
          caredServers={caredServers}
          onSelect={(addr, queryPort, name) => {
            setOpen(false);
            void selectUniqueTo(addr, queryPort, name);
          }}
        />
      </FilterPopup>
    </div>
  );
}
