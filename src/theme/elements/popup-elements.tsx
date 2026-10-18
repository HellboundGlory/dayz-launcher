import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useServerStore } from "@/stores/server-store";
import { useModsStore } from "@/stores/mods-store";
import { OFFICIAL_MAP_IDS } from "@/lib/official-maps";
import { cn } from "@/lib/utils";
import type { ServerFilter, SortDir, SortKey } from "@/types/filters";
import type { ElementNode, PopupLayoutFile } from "../renderer/types";
import { PopupHost } from "../interaction/popup-host";
import { OptionIcon } from "./option-icon";

/** Which popup an option/clear/close element lives in, and how to close it. */
export interface PopupContextValue {
  popupId: string;
  close: () => void;
}

const PopupContext = createContext<PopupContextValue>({ popupId: "", close: () => {} });
export const usePopupContext = () => useContext(PopupContext);

export function PopupContextProvider({
  popupId,
  close,
  children,
}: {
  popupId: string;
  close: () => void;
  children: ReactNode;
}) {
  return <PopupContext.Provider value={{ popupId, close }}>{children}</PopupContext.Provider>;
}

/**
 * A trigger's popup: the theme's own `layout/popups/<id>.json` through `PopupHost`
 * when it owns one, else `children` (the launcher's default body). Renders nothing
 * while closed. Shared by every `filter.*` popup trigger, `server.menu` and the mods menus.
 */
export function FilterPopup({
  open,
  popupId,
  close,
  themedPopup,
  triggerRef,
  children,
}: {
  open: boolean;
  popupId: string;
  close: () => void;
  themedPopup: PopupLayoutFile | undefined;
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <PopupContextProvider popupId={popupId} close={close}>
      {themedPopup ? (
        <PopupHost file={themedPopup} isOpen={open} onClose={close} triggerRef={triggerRef} />
      ) : (
        children
      )}
    </PopupContextProvider>
  );
}

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function mapDisplayValue(selected: string[], maps: [string, string][]): string {
  if (selected.length === 0) return "Any";
  if (selected.length === 1) return maps.find(([norm]) => norm === selected[0])?.[1] ?? selected[0];
  return `${selected.length} maps`;
}

export type TagField = "official" | "modded" | "first_person";

export const TAG_OPTIONS: { label: string; field: TagField }[] = [
  { label: "Official", field: "official" },
  { label: "Modded", field: "modded" },
  { label: "First person", field: "first_person" },
];

export function tagsDisplayValue(activeCount: number): string {
  return activeCount === 0 ? "Any" : `${activeCount} tag${activeCount > 1 ? "s" : ""}`;
}

export function cycleTagValue(cur: boolean | null): boolean | null {
  return cur === null ? true : cur === true ? false : null;
}

export const REGIONS: { code: string; label: string }[] = [
  { code: "EU", label: "Europe" },
  { code: "NA", label: "North America" },
  { code: "AS", label: "Asia" },
  { code: "OC", label: "Oceania" },
  { code: "SA", label: "South America" },
];

export function regionDisplayValue(selected: string[]): string {
  if (selected.length === 0) return "Any";
  if (selected.length === 1) return REGIONS.find((r) => r.code === selected[0])?.label ?? selected[0];
  return `${selected.length} regions`;
}

/** `last_played` is a valid sort key but the sort popup doesn't offer it (SPEC §7.4). */
export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "players", label: "Players" },
  { key: "ping", label: "Ping" },
  { key: "mod_count", label: "Mods" },
  { key: "name", label: "Name" },
  { key: "map", label: "Map" },
];

export function sortValueLabel(key: SortKey): string {
  return SORT_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

/** Picking the active key flips direction; picking a different key starts descending. */
export function nextSortDir(currentKey: SortKey, currentDir: SortDir, picked: SortKey): SortDir {
  return picked === currentKey ? (currentDir === "desc" ? "asc" : "desc") : "desc";
}

/** A filter option: the check column, then its label. Shared by the map, tag, region and sort popups. */
function OptionRow({
  selected,
  mark,
  state,
  ariaLabel,
  onClick,
  children,
}: {
  selected: boolean;
  /** Drawn in the check column in place of the tick. */
  mark?: ReactNode;
  state?: string | false;
  ariaLabel?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={ariaLabel}
      data-part="option"
      data-state={[selected && "selected", state].filter(Boolean).join(" ") || undefined}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-[var(--t-space-controlCompactX)] py-[var(--t-space-controlCompactY)] text-left hover:bg-surface transition-colors"
    >
      <span data-part="box" className="flex size-[var(--t-space-iconMedium)] shrink-0 items-center justify-center text-muted">
        {mark ?? <Check strokeWidth={2} className={cn("size-[var(--t-space-iconSmall)]", !selected && "opacity-0")} />}
      </span>
      {children}
    </button>
  );
}

export function mapMatchesQuery(query: string, [norm, disp]: [string, string]): boolean {
  const q = query.trim().toLowerCase();
  return norm.toLowerCase().includes(q) || disp.toLowerCase().includes(q);
}

export function PopupSeparator() {
  return <div data-part="separator" aria-hidden className="mx-[var(--t-space-separatorX)] my-[var(--t-space-separatorY)] h-[var(--t-border-hairline)] bg-line" />;
}

export function PopupMapOptions({ className, style }: { className?: string; style?: CSSProperties }) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const maps = useServerStore((s) => s.maps);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const selected = filter.maps ?? [];
  const toggle = (norm: string) => setFilter({ maps: toggleInList(selected, norm) });

  const matching = (entries: [string, string][]) => entries.filter((m) => mapMatchesQuery(query, m));
  const official = matching(OFFICIAL_MAP_IDS.flatMap((id) => maps.filter(([norm]) => norm === id)));
  const rest = matching(maps.filter(([norm]) => !OFFICIAL_MAP_IDS.includes(norm)));
  const status = maps.length === 0 ? "Loading maps..." : official.length + rest.length === 0 ? "No maps match" : null;

  const option = ([norm, disp]: [string, string]) => (
    <OptionRow key={norm} selected={selected.includes(norm)} onClick={() => toggle(norm)}>
      <span className="truncate">{disp}</span>
    </OptionRow>
  );

  return (
    <div data-el="popup.mapOptions" className={className} style={style}>
      <input
        data-part="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown") return;
          e.preventDefault();
          listRef.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
        }}
        placeholder="Search maps"
        aria-label="Search maps"
      />
      {status && (
        <div role="status" data-part="empty" className="px-2 py-1.5 [font-size:var(--t-type-size-sm)] text-muted">
          {status}
        </div>
      )}
      <div ref={listRef} role="listbox" aria-multiselectable>
        {official.map(option)}
        {official.length > 0 && rest.length > 0 && <PopupSeparator />}
        {rest.map(option)}
      </div>
    </div>
  );
}

export function PopupTagOptions({ className, style }: { className?: string; style?: CSSProperties }) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);

  const values: Record<TagField, boolean | null> = {
    official: filter.official,
    modded: filter.modded,
    first_person: filter.first_person,
  };
  const cycle = (field: TagField) => setFilter({ [field]: cycleTagValue(values[field]) });

  const indicatorState = (val: boolean | null) => (val === true ? "included" : val === false && "excluded");
  const indicatorText = (val: boolean | null) => (val === true ? "✓" : val === false ? "✗" : "");

  return (
    <div data-el="popup.tagOptions" role="listbox" aria-multiselectable className={className ?? "space-y-1"} style={style}>
      {TAG_OPTIONS.map((opt) => {
        const val = values[opt.field];
        return (
          <OptionRow
            key={opt.field}
            selected={val === true}
            state={indicatorState(val)}
            ariaLabel={val === false ? `${opt.label}, excluded` : undefined}
            mark={
              <span data-part="indicator" className="font-mono-data [font-size:var(--t-type-size-sm)]">
                {indicatorText(val)}
              </span>
            }
            onClick={() => cycle(opt.field)}
          >
            <span className="truncate">{opt.label}</span>
          </OptionRow>
        );
      })}
    </div>
  );
}

export function PopupRegionOptions({ className, style }: { className?: string; style?: CSSProperties }) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const selected = filter.countries ?? [];
  const toggle = (code: string) => setFilter({ countries: toggleInList(selected, code) });

  return (
    <div data-el="popup.regionOptions" role="listbox" aria-multiselectable className={className ?? "space-y-1"} style={style}>
      {REGIONS.map((region) => (
        <OptionRow key={region.code} selected={selected.includes(region.code)} onClick={() => toggle(region.code)}>
          <span className="truncate">{region.label}</span>
        </OptionRow>
      ))}
    </div>
  );
}

export function PopupRegionNote({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div data-el="popup.regionNote" className={className} style={style}>
      <span data-part="text">Approximate — based on IP block, not confirmed location</span>
    </div>
  );
}

export function PopupSortOptions({ className, style }: { className?: string; style?: CSSProperties }) {
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const setSort = useServerStore((s) => s.setSort);

  const pick = (key: SortKey) => setSort(key, nextSortDir(sortKey, sortDir, key));

  return (
    <div data-el="popup.sortOptions" role="listbox" className={className} style={style}>
      {SORT_OPTIONS.map((opt) => {
        const selected = opt.key === sortKey;
        const direction = selected && (sortDir === "asc" ? "ascending" : "descending");
        return (
          <OptionRow key={opt.key} selected={selected} state={direction} onClick={() => pick(opt.key)}>
            <span className="truncate">{opt.label}</span>
          </OptionRow>
        );
      })}
    </div>
  );
}

/** The select-unique popup's rows, shared by `mods.selectUnique`'s default popup and `popup.uniqueServerOptions`. */
export function UniqueServerOptionsList({
  caredServers,
  onSelect,
}: {
  caredServers: { addr: string; query_port: number; name: string }[];
  onSelect: (addr: string, queryPort: number, name: string) => void;
}) {
  if (caredServers.length === 0) {
    return (
      <p data-part="empty" className="px-3 py-2 [font-size:var(--t-type-label-size)] text-muted">
        No favourites or recently played servers yet.
      </p>
    );
  }
  return (
    <>
      {caredServers.map((srv) => {
        const label = srv.name || `${srv.addr}:${srv.query_port}`;
        return (
          <button
            type="button"
            key={`${srv.addr}:${srv.query_port}`}
            data-part="option"
            title={label}
            onClick={() => onSelect(srv.addr, srv.query_port, srv.name)}
            className="flex w-full items-center gap-2 [border-radius:var(--t-radius-controlCompact)] px-[var(--t-space-controlCompactX)] py-[var(--t-space-controlCompactY)] text-left transition-colors hover:bg-surface"
          >
            <ChevronRight className="size-3 shrink-0 text-muted" />
            <span className="min-w-0 whitespace-normal break-words [font-size:var(--t-type-body-size)] leading-snug text-ink">
              {label}
            </span>
          </button>
        );
      })}
    </>
  );
}

export function PopupUniqueServerOptions({ className, style }: { className?: string; style?: CSSProperties }) {
  const { caredServers, selectUniqueTo } = useModsStore(
    useShallow((s) => ({ caredServers: s.caredServers, selectUniqueTo: s.selectUniqueTo })),
  );
  const { close } = usePopupContext();

  return (
    <div data-el="popup.uniqueServerOptions" className={className} style={style}>
      <UniqueServerOptionsList
        caredServers={caredServers}
        onSelect={(addr, queryPort, name) => {
          close();
          void selectUniqueTo(addr, queryPort, name);
        }}
      />
    </div>
  );
}

const CLEARABLE_POPUPS: Record<string, { empty: (filter: ServerFilter) => boolean; clear: () => Partial<ServerFilter> }> = {
  mapFilter: {
    empty: (filter) => (filter.maps ?? []).length === 0,
    clear: () => ({ maps: [] }),
  },
  tagsFilter: {
    empty: (filter) => filter.official === null && filter.modded === null && filter.first_person === null,
    clear: () => ({ official: null, modded: null, first_person: null }),
  },
  regionFilter: {
    empty: (filter) => (filter.countries ?? []).length === 0,
    clear: () => ({ countries: [] }),
  },
};

export function PopupClear({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { popupId } = usePopupContext();
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const label = (options?.label as string) ?? "CLEAR";

  const scope = CLEARABLE_POPUPS[popupId];
  const disabled = scope ? scope.empty(filter) : true;

  const handleClick = () => {
    if (disabled || !scope) return;
    setFilter(scope.clear());
  };

  return (
    <button
      type="button"
      data-el="popup.clear"
      data-state={disabled ? "disabled" : undefined}
      onClick={handleClick}
      disabled={disabled}
      className={className ?? "flex w-full items-center gap-2 px-[var(--t-space-controlCompactX)] py-[var(--t-space-controlCompactY)] text-muted font-semibold hover:bg-surface transition-colors disabled:opacity-50"}
      style={style}
    >
      <X className="size-3" />
      <span data-part="label">{label}</span>
    </button>
  );
}

export function PopupClose({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { close } = usePopupContext();

  return (
    <button
      type="button"
      data-el="popup.close"
      onClick={close}
      aria-label="Close"
      className={className ?? "text-muted hover:text-ink"}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={X} className="size-3.5" />
      </span>
    </button>
  );
}

/** Every `popup.*` element; `undefined` for anything else. */
export function renderPopupElement(
  node: ElementNode,
  { className, style }: { className?: string; style?: CSSProperties },
): ReactNode | undefined {
  switch (node.element) {
    case "popup.mapOptions":
      return <PopupMapOptions className={className} style={style} />;
    case "popup.tagOptions":
      return <PopupTagOptions className={className} style={style} />;
    case "popup.regionOptions":
      return <PopupRegionOptions className={className} style={style} />;
    case "popup.regionNote":
      return <PopupRegionNote className={className} style={style} />;
    case "popup.sortOptions":
      return <PopupSortOptions className={className} style={style} />;
    case "popup.uniqueServerOptions":
      return <PopupUniqueServerOptions className={className} style={style} />;
    case "popup.clear":
      return <PopupClear options={node.options} className={className} style={style} />;
    case "popup.close":
      return <PopupClose options={node.options} className={className} style={style} />;
    default:
      return undefined;
  }
}
