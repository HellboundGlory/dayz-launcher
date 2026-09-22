import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronRight, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useServerStore } from "@/stores/server-store";
import { useModsStore } from "@/stores/mods-store";
import type { ServerFilter, SortDir, SortKey } from "@/types/filters";
import type { ElementNode, PopupLayoutFile } from "../renderer/types";
import { PopupHost, type TriggerRect } from "../interaction/popup-host";
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

/** Measures a trigger's viewport rect once a themed anchored popup opens. */
export function useTriggerRect(ref: RefObject<HTMLElement | null>, active: boolean): TriggerRect | undefined {
  const [rect, setRect] = useState<TriggerRect | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      setRect(undefined);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return rect;
}

/**
 * A trigger's popup: the theme's own `layout/popups/<id>.json` through `PopupHost`
 * when it owns one, else `children` (the launcher's default body). Renders nothing
 * while closed. Shared by every `filter.*` popup trigger and `mods.selectUnique`.
 */
export function FilterPopup({
  open,
  popupId,
  close,
  themedPopup,
  triggerRect,
  triggerRef,
  children,
}: {
  open: boolean;
  popupId: string;
  close: () => void;
  themedPopup: PopupLayoutFile | undefined;
  triggerRect?: TriggerRect;
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <PopupContextProvider popupId={popupId} close={close}>
      {themedPopup ? (
        <PopupHost file={themedPopup} isOpen={open} onClose={close} triggerRect={triggerRect} triggerRef={triggerRef} />
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
  { label: "OFFICIAL", field: "official" },
  { label: "MODDED", field: "modded" },
  { label: "1PP ONLY", field: "first_person" },
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

/** Picking the active key flips direction; picking a different key starts descending (matches legacy `server-table.tsx`). */
export function nextSortDir(currentKey: SortKey, currentDir: SortDir, picked: SortKey): SortDir {
  return picked === currentKey ? (currentDir === "desc" ? "asc" : "desc") : "desc";
}

export function PopupMapOptions({ className, style }: { className?: string; style?: CSSProperties }) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const maps = useServerStore((s) => s.maps);
  const selected = filter.maps ?? [];
  const toggle = (norm: string) => setFilter({ maps: toggleInList(selected, norm) });

  return (
    <div data-el="popup.mapOptions" className={className} style={style}>
      {maps.length === 0 && (
        <div data-part="empty" className="px-2 py-1.5 text-[10px] text-muted">
          Loading maps...
        </div>
      )}
      {maps.map(([norm, disp]) => (
        <label
          key={norm}
          data-part="option"
          data-state={selected.includes(norm) ? "selected" : undefined}
          className="flex items-center gap-2 px-2 py-1.5 hover:bg-surface cursor-pointer"
        >
          <input
            data-part="box"
            type="checkbox"
            checked={selected.includes(norm)}
            onChange={() => toggle(norm)}
            className="size-3 accent-accent"
          />
          {disp}
        </label>
      ))}
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

  const indicatorState = (val: boolean | null) => (val === true ? "included" : val === false ? "excluded" : undefined);
  const indicatorText = (val: boolean | null) => (val === true ? "✓" : val === false ? "✗" : "");

  return (
    <div data-el="popup.tagOptions" className={className ?? "space-y-1"} style={style}>
      {TAG_OPTIONS.map((opt) => {
        const val = values[opt.field];
        return (
          <button
            key={opt.field}
            type="button"
            data-part="option"
            data-state={indicatorState(val)}
            onClick={() => cycle(opt.field)}
            className="flex w-full items-center justify-between px-2 py-1 hover:bg-surface transition-colors"
          >
            <span>{opt.label}</span>
            <span data-part="indicator" className="font-mono-data text-[10px]">
              {indicatorText(val)}
            </span>
          </button>
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
    <div data-el="popup.regionOptions" className={className ?? "space-y-1"} style={style}>
      {REGIONS.map((region) => (
        <label
          key={region.code}
          data-part="option"
          data-state={selected.includes(region.code) ? "selected" : undefined}
          className="flex items-center gap-2 px-2 py-1 hover:bg-surface cursor-pointer"
        >
          <input
            data-part="box"
            type="checkbox"
            checked={selected.includes(region.code)}
            onChange={() => toggle(region.code)}
            className="size-3 accent-accent"
          />
          {region.label}
        </label>
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
    <div data-el="popup.sortOptions" className={className} style={style}>
      {SORT_OPTIONS.map((opt) => {
        const selected = opt.key === sortKey;
        const states = [selected && "selected", selected && (sortDir === "asc" ? "ascending" : "descending")]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={opt.key}
            type="button"
            data-part="option"
            data-state={states || undefined}
            onClick={() => pick(opt.key)}
            className="flex w-full items-center justify-between px-2 py-1 hover:bg-surface transition-colors"
          >
            <span>{opt.label}</span>
            {selected && <span className="font-mono-data text-[10px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
          </button>
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
            className="flex w-full items-center gap-2 [border-radius:var(--t-radius-controlCompact)] px-3 py-2 text-left transition-colors hover:bg-surface"
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
      className={className ?? "flex w-full items-center gap-2 px-2 py-1 text-muted font-semibold hover:bg-surface transition-colors disabled:opacity-50"}
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
