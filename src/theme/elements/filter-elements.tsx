import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Search, RefreshCw, RotateCcw, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";
import { useElementContext } from "./context";
import { OptionIcon } from "./option-icon";
import { getThemeOwnedLayout, useLayoutSubscription } from "../theme-store";
import type { PopupLayoutFile } from "../renderer/types";
import {
  FilterPopup,
  PopupClear,
  PopupMapOptions,
  PopupRegionOptions,
  PopupSortOptions,
  PopupTagOptions,
  mapDisplayValue,
  regionDisplayValue,
  sortValueLabel,
  tagsDisplayValue,
  useTriggerRect,
} from "./popup-elements";

export {
  REGIONS,
  cycleTagValue,
  mapDisplayValue,
  regionDisplayValue,
  tagsDisplayValue,
  toggleInList,
} from "./popup-elements";


const SEARCH_DEBOUNCE_MS = 250;

function useDropdown() {
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

function DropdownTrigger({
  label,
  value,
  active,
  open,
  onClick,
  extra,
}: {
  label: string | null;
  value: string;
  active: boolean;
  open: boolean;
  onClick: () => void;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      data-part="trigger"
      onClick={onClick}
      aria-haspopup="listbox"
      aria-expanded={open}
      className="flex items-center gap-1.5 border-0 bg-transparent p-0 [font:inherit] [color:inherit]"
    >
      {label !== null && (
        <span data-part="label" className="text-muted text-[10px] font-bold">
          {label}
        </span>
      )}
      <span data-part="value" className={cn("font-semibold", active && "text-accent")}>
        {value}
      </span>
      {extra}
      <ChevronDown data-part="chevron" className="size-3 text-muted ml-0.5" />
    </button>
  );
}

function DropdownRoot({
  el,
  states,
  className,
  style,
  innerRef,
  children,
}: {
  el: string;
  states: string[];
  className?: string;
  style?: CSSProperties;
  innerRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={innerRef}
      data-el={el}
      data-state={states.length > 0 ? states.join(" ") : undefined}
      className={className ?? "relative flex items-center gap-1.5 border border-border bg-surface2 px-2.5 py-1 text-xs text-text transition-colors hover:border-accent"}
      style={style}
    >
      {children}
    </div>
  );
}

export function FilterSearch({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const [text, setText] = useState(filter.search ?? "");
  const showIcon = options?.showIcon !== false;

  useEffect(() => {
    setText((current) => (current === (filter.search ?? "") ? current : filter.search ?? ""));
  }, [filter.search]);

  useEffect(() => {
    const next = text.trim() || null;
    if (next === (filter.search ?? null)) return;
    const timer = window.setTimeout(() => setFilter({ search: next }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const filled = text.trim().length > 0;

  return (
    <div
      data-el="filter.search"
      data-state={filled ? "filled" : undefined}
      className={className ?? "flex items-center gap-2 border border-border bg-surface2 px-2.5 py-1 text-sm text-text"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={Search} className="size-3.5 text-muted shrink-0" />
        </span>
      )}
      <input
        data-part="input"
        type="text"
        placeholder="Search name or description"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="bg-transparent outline-none text-text placeholder:text-muted min-w-[180px] text-xs"
      />
    </div>
  );
}

export function FilterMap({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const maps = useServerStore((s) => s.maps);
  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string) ?? "MAP";
  const { open, setOpen, ref } = useDropdown();
  useLayoutSubscription();
  const themedPopup = getThemeOwnedLayout("layout/popups/mapFilter.json") as PopupLayoutFile | undefined;
  const triggerRect = useTriggerRect(ref, open && !!themedPopup);

  const selected = filter.maps ?? [];
  const value = mapDisplayValue(selected, maps);
  const active = selected.length > 0;

  const states = [active && "active", open && "open"].filter(Boolean) as string[];

  return (
    <DropdownRoot el="filter.map" states={states} className={className} style={style} innerRef={ref}>
      <DropdownTrigger
        label={showLabel ? label : null}
        value={value}
        active={active}
        open={open}
        onClick={() => setOpen(!open)}
      />
      <FilterPopup
        open={open}
        popupId="mapFilter"
        close={() => setOpen(false)}
        themedPopup={themedPopup}
        triggerRect={triggerRect}
        triggerRef={ref}
      >
        <div
          data-part="popup"
          className="absolute left-0 top-full mt-1 z-30 max-h-64 min-w-[224px] overflow-y-auto border border-border bg-surface2 p-1 shadow-lg text-xs"
        >
          <PopupMapOptions />
        </div>
      </FilterPopup>
    </DropdownRoot>
  );
}

export function FilterTags({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string) ?? "TAGS";
  const { open, setOpen, ref } = useDropdown();
  useLayoutSubscription();
  const themedPopup = getThemeOwnedLayout("layout/popups/tagsFilter.json") as PopupLayoutFile | undefined;
  const triggerRect = useTriggerRect(ref, open && !!themedPopup);

  const activeCount = [filter.official, filter.modded, filter.first_person].filter((v) => v !== null).length;
  const value = tagsDisplayValue(activeCount);
  const active = activeCount > 0;

  const states = [active && "active", open && "open"].filter(Boolean) as string[];

  return (
    <DropdownRoot el="filter.tags" states={states} className={className} style={style} innerRef={ref}>
      <DropdownTrigger
        label={showLabel ? label : null}
        value={value}
        active={active}
        open={open}
        onClick={() => setOpen(!open)}
      />
      <FilterPopup
        open={open}
        popupId="tagsFilter"
        close={() => setOpen(false)}
        themedPopup={themedPopup}
        triggerRect={triggerRect}
        triggerRef={ref}
      >
        <div
          data-part="popup"
          className="absolute left-0 top-full mt-1 z-30 min-w-[208px] border border-border bg-surface2 p-1.5 shadow-lg text-xs space-y-1"
        >
          <PopupTagOptions />
        </div>
      </FilterPopup>
    </DropdownRoot>
  );
}

export function FilterRegion({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string) ?? "REGION";
  const { open, setOpen, ref } = useDropdown();
  useLayoutSubscription();
  const themedPopup = getThemeOwnedLayout("layout/popups/regionFilter.json") as PopupLayoutFile | undefined;
  const triggerRect = useTriggerRect(ref, open && !!themedPopup);

  const selected = filter.countries ?? [];
  const value = regionDisplayValue(selected);
  const active = selected.length > 0;

  const states = [active && "active", open && "open"].filter(Boolean) as string[];

  return (
    <DropdownRoot el="filter.region" states={states} className={className} style={style} innerRef={ref}>
      <DropdownTrigger
        label={showLabel ? label : null}
        value={value}
        active={active}
        open={open}
        onClick={() => setOpen(!open)}
      />
      <FilterPopup
        open={open}
        popupId="regionFilter"
        close={() => setOpen(false)}
        themedPopup={themedPopup}
        triggerRect={triggerRect}
        triggerRef={ref}
      >
        <div
          data-part="popup"
          className="absolute left-0 top-full mt-1 z-30 min-w-[176px] max-h-64 overflow-y-auto border border-border bg-surface2 p-1.5 shadow-lg text-xs space-y-1"
        >
          <PopupClear />
          <PopupRegionOptions />
        </div>
      </FilterPopup>
    </DropdownRoot>
  );
}

const PING_MAX = 500;

export function pingSliderValue(maxPing: number | null): number {
  return maxPing === null ? PING_MAX : maxPing;
}

export function pingDisplayValue(maxPing: number | null): string {
  return maxPing === null ? "Any" : `${maxPing}ms`;
}

export function nextPingFilter(sliderValue: number): number | null {
  return sliderValue >= PING_MAX ? null : sliderValue;
}

export function FilterMaxPing({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const showLabel = options?.showLabel !== false;
  const showValue = options?.showValue !== false;
  const label = (options?.label as string) ?? "PING";

  const maxPing = filter.max_ping;
  const sliderValue = pingSliderValue(maxPing);
  const active = maxPing !== null;

  return (
    <div
      data-el="filter.maxPing"
      data-state={active ? "active" : undefined}
      className={className ?? "flex items-center gap-2 px-2.5 py-1 text-xs text-text"}
      style={style}
    >
      {showLabel && (
        <span data-part="label" className="text-muted text-[10px] font-bold">
          {label}
        </span>
      )}
      <span data-part="track" className="inline-flex items-center">
        <input
          data-part="knob"
          type="range"
          min={50}
          max={PING_MAX}
          step={10}
          value={sliderValue}
          onChange={(e) => setFilter({ max_ping: nextPingFilter(Number(e.target.value)) })}
          className="w-20 accent-accent cursor-pointer h-1.5 bg-surface rounded-none"
        />
      </span>
      {showValue && (
        <span data-part="value" className="text-xs font-mono-data tabular-nums text-muted2 w-9">
          {pingDisplayValue(maxPing)}
        </span>
      )}
    </div>
  );
}

function HideToggle({
  el,
  defaultLabel,
  field,
  options,
  className,
  style,
}: {
  el: string;
  defaultLabel: string;
  field: "hide_empty" | "hide_full" | "hide_locked" | "hide_offline";
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const label = (options?.label as string) ?? defaultLabel;
  const control = (options?.control as "checkbox" | "switch" | "button") ?? "button";
  const on = Boolean(filter[field]);

  const toggle = () => setFilter({ [field]: !on });

  const defaultClass = cn(
    "px-2.5 py-1 text-xs font-bold uppercase tracking-wider border transition-colors",
    on
      ? "border-accent bg-accent text-bg shadow-[0_0_6px_var(--accent)]"
      : "border-border bg-surface text-muted2 hover:text-text hover:border-border",
  );

  const commonProps = {
    "data-el": el,
    "data-state": on ? "on" : undefined,
    className: className ?? defaultClass,
    style,
    onClick: toggle,
  };

  const labelSpan = (
    <span data-part="label">{label}</span>
  );

  const iconSpan = options?.icon !== undefined && options.icon !== "none" && (
    <span data-part="icon">
      <OptionIcon icon={options.icon} fallback={Check} className="size-3" />
    </span>
  );

  if (control === "checkbox" || control === "switch") {
    return (
      <div
        {...commonProps}
        role={control}
        aria-checked={on}
        className={cn(commonProps.className, "flex items-center gap-1.5 cursor-pointer")}
      >
        <span data-part="box" className="size-3 border border-border inline-flex items-center justify-center">
          {on && <span className="size-1.5 bg-accent" />}
        </span>
        {iconSpan}
        {labelSpan}
      </div>
    );
  }

  return (
    <button type="button" {...commonProps} aria-pressed={on}>
      {iconSpan}
      {labelSpan}
    </button>
  );
}

export function FilterHideEmpty(props: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  return <HideToggle el="filter.hideEmpty" defaultLabel="Hide empty" field="hide_empty" {...props} />;
}

export function FilterHideFull(props: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  return <HideToggle el="filter.hideFull" defaultLabel="Hide full" field="hide_full" {...props} />;
}

export function FilterHideLocked(props: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  return <HideToggle el="filter.hideLocked" defaultLabel="Hide locked" field="hide_locked" {...props} />;
}

export function FilterHideOffline(props: { options?: Record<string, unknown>; className?: string; style?: CSSProperties }) {
  return <HideToggle el="filter.hideOffline" defaultLabel="Hide offline" field="hide_offline" {...props} />;
}

export function ServersRefresh({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { onRefresh, refreshing } = useElementContext();
  const display = (options?.display as "iconLabel" | "label" | "icon") ?? "iconLabel";
  const labelText = refreshing ? "Refreshing…" : "Refresh";

  return (
    <button
      type="button"
      data-el="servers.refresh"
      data-state={refreshing ? "busy" : undefined}
      onClick={onRefresh}
      disabled={refreshing}
      aria-label="Refresh server list"
      className={className ?? "flex items-center gap-1.5 p-1.5 border border-border bg-surface2 hover:border-accent text-muted hover:text-ink transition-colors disabled:opacity-60 disabled:cursor-not-allowed"}
      style={style}
    >
      {display !== "label" && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={RefreshCw} className={cn("size-3.5", refreshing && "animate-spin")} />
        </span>
      )}
      {display !== "icon" && (
        <span data-part="label" className="text-[10px] font-semibold uppercase">
          {labelText}
        </span>
      )}
    </button>
  );
}

export function modsFilterValue(included: number, excluded: number): string {
  if (included === 0 && excluded === 0) return "Any";
  if (excluded === 0) return `${included} mod${included === 1 ? "" : "s"}`;
  if (included === 0) return `${excluded} excluded`;
  return `${included} in, ${excluded} out`;
}

export function FilterMods({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const { openModFilter, modFilterOpen } = useElementContext();
  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string) ?? "MODS";

  const included = filter.mod_ids.length;
  const excluded = filter.mod_ids_exclude.length;
  const value = modsFilterValue(included, excluded);
  const active = included + excluded > 0;

  return (
    <button
      type="button"
      data-el="filter.mods"
      data-state={active ? "active" : undefined}
      onClick={openModFilter}
      aria-haspopup="dialog"
      aria-expanded={modFilterOpen}
      className={className ?? "flex items-center gap-1.5 border border-border bg-surface2 px-2.5 py-1 text-xs text-text transition-colors hover:border-accent"}
      style={style}
    >
      {showLabel && (
        <span data-part="label" className="text-muted text-[10px] font-bold">
          {label}
        </span>
      )}
      <span data-part="value" className={cn("font-semibold", active && "text-accent")}>
        {value}
      </span>
      <ChevronDown data-part="chevron" className="size-3 text-muted ml-0.5" />
    </button>
  );
}

export function FilterSort({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string) ?? "SORT";
  const { open, setOpen, ref } = useDropdown();
  useLayoutSubscription();
  const themedPopup = getThemeOwnedLayout("layout/popups/sort.json") as PopupLayoutFile | undefined;
  const triggerRect = useTriggerRect(ref, open && !!themedPopup);

  const value = sortValueLabel(sortKey);
  const active = !(sortKey === "players" && sortDir === "desc");

  const states = [active && "active", open && "open"].filter(Boolean) as string[];

  return (
    <DropdownRoot el="filter.sort" states={states} className={className} style={style} innerRef={ref}>
      <DropdownTrigger
        label={showLabel ? label : null}
        value={value}
        active={active}
        open={open}
        onClick={() => setOpen(!open)}
        extra={
          <span data-part="direction" className="text-[10px] text-muted">
            {sortDir === "asc" ? "↑" : "↓"}
          </span>
        }
      />
      <FilterPopup
        open={open}
        popupId="sort"
        close={() => setOpen(false)}
        themedPopup={themedPopup}
        triggerRect={triggerRect}
        triggerRef={ref}
      >
        <div
          data-part="popup"
          className="absolute left-0 top-full mt-1 z-30 min-w-[176px] border border-border bg-surface2 p-1.5 shadow-lg text-xs space-y-1"
        >
          <PopupSortOptions />
        </div>
      </FilterPopup>
    </DropdownRoot>
  );
}

export function FilterReset({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const resetFilter = useServerStore((s) => s.resetFilter);
  const display = (options?.display as "iconLabel" | "label" | "icon") ?? "iconLabel";
  const label = (options?.label as string) ?? "Reset";

  return (
    <button
      type="button"
      data-el="filter.reset"
      onClick={() => resetFilter()}
      aria-label="Reset filters"
      className={className ?? "flex items-center gap-1 px-2 py-1 text-xs border border-border bg-surface2 hover:border-accent text-muted hover:text-ink transition-colors"}
      style={style}
    >
      {display !== "label" && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={RotateCcw} className="size-3" />
        </span>
      )}
      {display !== "icon" && (
        <span data-part="label" className="text-[10px] font-semibold uppercase">
          {label}
        </span>
      )}
    </button>
  );
}
