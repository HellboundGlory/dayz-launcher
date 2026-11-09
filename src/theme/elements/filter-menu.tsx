import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { DEFAULT_FILTER, useServerStore } from "@/stores/server-store";
import { PING_PRESETS, type ServerFilter } from "@/types/filters";
import { activeFilterCount } from "@/lib/filter-summary";
import type { FilterFacets } from "@/lib/tauri";
import { useFilterFacets } from "@/hooks/use-filter-facets";
import type { ElementNode } from "../renderer/types";
import { useViewportWidth } from "../renderer/use-viewport-width";
import { useAnchoredPopup } from "../interaction/use-anchored-popup";
import { usePopupKeyboard } from "../interaction/popup-keyboard";
import { useElementContext } from "./context";
import { useThemedPopupTrigger } from "./use-themed-popup-trigger";
import { modsFilterValue } from "./filter-elements";
import {
  OptionRow,
  PopupMapOptions,
  PopupSeparator,
  REGIONS,
  TriggerPopup,
  mapDisplayValue,
  regionDisplayValue,
  toggleInList,
} from "./popup-elements";

const NARROW_MENU_WIDTH = 720;
const MENU_WIDE_WIDTH = 600;
const MENU_SCREEN_PAD = 16;

interface Choice<V> {
  label: string;
  value: V;
}

type TriChoice = Choice<boolean | null>;

const SERVER_TYPE: TriChoice[] = [
  { label: "Any", value: null },
  { label: "Official", value: true },
  { label: "Community", value: false },
];

const PING: Choice<number | null>[] = [
  { label: "Any", value: null },
  ...PING_PRESETS.map((limit) => ({ label: `< ${limit}`, value: limit as number | null })),
];

const PERSPECTIVE: TriChoice[] = [
  { label: "Any", value: null },
  { label: "1PP only", value: true },
  { label: "3PP allowed", value: false },
];

const TIME_OF_DAY: Choice<ServerFilter["time_of_day"]>[] = [
  { label: "Any", value: null },
  { label: "Day", value: "day" },
  { label: "Night", value: "night" },
];

const MODS: TriChoice[] = [
  { label: "Any", value: null },
  { label: "Modded", value: true },
  { label: "Vanilla", value: false },
];

interface FilterMenuData {
  facets: FilterFacets | null;
  /** True once the last count request failed. */
  facetError: boolean;
  installedVersion: string | null;
  close: () => void;
}

export const FilterMenuDataContext = createContext<FilterMenuData>({
  facets: null,
  facetError: false,
  installedVersion: null,
  close: () => {},
});

/** Row counts for the map rows, keyed by the map keys each facet row stands for; none until the counts arrive. */
export function mapCounts(facets: FilterFacets | null): Record<string, number> | undefined {
  if (!facets) return undefined;
  const counts: Record<string, number> = {};
  for (const row of facets.maps) {
    for (const key of row.values) counts[key] = (counts[key] ?? 0) + row.count;
  }
  return counts;
}

interface FocusTarget {
  querySelector(selector: string): { focus(): void } | null;
}

/** Puts focus back on the select row that opened a list. */
export function focusSelectRow(anchor: FocusTarget | null): void {
  anchor?.querySelector('[data-part="select"]')?.focus();
}

/** Escape closes the open list before the menu: the list swallows the key. */
export function handleListEscape(
  event: { key: string; preventDefault(): void; stopPropagation(): void },
  closeList: () => void,
): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeList();
}

/** A single-choice list closes on its pick, putting focus back on the row. */
export function pickVersion(
  version: string | null,
  setFilter: (patch: Partial<ServerFilter>) => void,
  closeList: () => void,
): void {
  setFilter({ version });
  closeList();
}

/** Clears every filter but keeps what was typed in the search box. */
export function resetKeepingSearch(): void {
  const { search, favourites_only, recent_only } = useServerStore.getState().filter;
  // One update with the search unchanged, so its lookup survives.
  useServerStore.getState().setFilter({ ...DEFAULT_FILTER, search, favourites_only, recent_only });
}

function countText(count: number | undefined): string {
  return (count ?? 0).toLocaleString("en");
}

function Group({
  element,
  heading,
  className,
  style,
  children,
}: {
  element: string;
  heading: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section data-el={element} data-part="group" className={className ?? "grid gap-2.5 px-4 py-3"} style={style}>
      <h3 data-part="heading" className="m-0 [font-size:var(--t-type-micro-size)] font-semibold uppercase [letter-spacing:0.1em] text-muted">
        {heading}
      </h3>
      {children}
    </section>
  );
}

function SegmentRow<V extends string | number | boolean | null>({
  label,
  value,
  choices,
  onPick,
  hideLabel,
}: {
  label: string;
  value: V;
  choices: Choice<V>[];
  onPick: (value: V) => void;
  /** Names the group for assistive tech without repeating a visible heading. */
  hideLabel?: boolean;
}) {
  return (
    <div data-part="row" className="grid gap-1.5">
      <span data-part="label" className={hideLabel ? "sr-only" : "text-muted2"}>
        {label}
      </span>
      <div data-part="segments" role="group" aria-label={label} className="flex overflow-hidden border border-line bg-bg">
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <button
              key={String(choice.value)}
              type="button"
              data-part="segment"
              data-state={selected ? "selected" : undefined}
              aria-pressed={selected}
              onClick={() => onPick(choice.value)}
              className="flex-1 px-1 py-1.5 text-center whitespace-nowrap text-muted2 transition-colors hover:text-ink data-[state=selected]:font-semibold data-[state=selected]:text-ink"
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
  hint,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  hint?: string;
}) {
  return (
    <div data-part="row">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-part="checkbox"
        onClick={onToggle}
        className="grid grid-cols-[15px_1fr] items-start gap-x-2.5 text-left text-ink"
      >
        <span
          data-part="box"
          data-state={checked ? "on" : undefined}
          className="mt-px grid size-[15px] place-items-center border border-muted bg-bg data-[state=on]:border-accent data-[state=on]:bg-accent data-[state=on]:text-bg"
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
        <span className="grid gap-0.5">
          <span>{label}</span>
          {hint && <span className="[font-size:var(--t-type-micro-size)] text-muted">{hint}</span>}
        </span>
      </button>
    </div>
  );
}

function SelectRow({
  label,
  value,
  active,
  open,
  onClick,
  anchorRef,
}: {
  label: string;
  value: string;
  active: boolean;
  open: boolean;
  onClick: () => void;
  anchorRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={anchorRef} data-part="row" className="relative grid gap-1.5">
      <span data-part="label" className="text-muted2">
        {label}
      </span>
      <button
        type="button"
        data-part="select"
        data-state={[active && "on", open && "open"].filter(Boolean).join(" ") || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onClick}
        className="flex h-7 items-center gap-1.5 overflow-hidden border border-line bg-surface2 px-2.5 text-left text-ink data-[state~=on]:border-accent-line data-[state~=open]:border-accent"
      >
        <span data-part="value" className="min-w-0 flex-1 truncate">
          {value}
        </span>
        <ChevronDown data-part="chevron" className="size-3 shrink-0 text-muted2" />
      </button>
    </div>
  );
}

/** Open state for a select's list, closing back onto the row that opened it. */
function useSelectList() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    focusSelectRow(anchorRef.current);
  }, []);
  return { anchorRef, open, setOpen, close };
}

/** A list under its select row, over the menu: as wide as the row or wider, capped to the space left. */
function SelectList({
  anchorRef,
  label,
  multiselect,
  onClose,
  ownListbox,
  children,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  label: string;
  multiselect?: boolean;
  onClose: () => void;
  /** The children carry their own listbox, so this wrapper is not one. */
  ownListbox?: boolean;
  children: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [minWidth, setMinWidth] = useState<number>();
  const style = useAnchoredPopup(true, anchorRef, listRef, { side: "bottom", align: "start", offset: 2 });

  useLayoutEffect(() => {
    setMinWidth(anchorRef.current?.offsetWidth);
  }, [anchorRef]);

  usePopupKeyboard(true, listRef, onClose);

  useEffect(() => {
    // Capture on window, ahead of the menu's own document listener, so Escape closes the list first.
    const onKey = (e: KeyboardEvent) => handleListEscape(e, onClose);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (listRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [anchorRef, onClose]);

  return (
    <div
      ref={listRef}
      role={ownListbox ? undefined : "listbox"}
      aria-label={ownListbox ? undefined : label}
      aria-multiselectable={ownListbox ? undefined : multiselect}
      data-part="list"
      className="flex flex-col overflow-y-auto border border-line bg-surface2 p-1 shadow-lg"
      style={{ ...style, minWidth }}
    >
      {children}
    </div>
  );
}

function MapSelect() {
  const filter = useServerStore((s) => s.filter);
  const maps = useServerStore((s) => s.maps);
  const setFilter = useServerStore((s) => s.setFilter);
  const { facets } = useContext(FilterMenuDataContext);
  const { anchorRef, open, setOpen, close } = useSelectList();
  const counts = mapCounts(facets);
  const selected = filter.maps ?? [];

  return (
    <>
      <SelectRow
        label="Map"
        value={mapDisplayValue(selected, maps)}
        active={selected.length > 0}
        open={open}
        onClick={() => setOpen(!open)}
        anchorRef={anchorRef}
      />
      {open && (
        <SelectList anchorRef={anchorRef} label="Maps" multiselect ownListbox onClose={close}>
          <PopupMapOptions counts={counts} />
          <PopupSeparator />
          <button
            type="button"
            data-part="clear"
            disabled={selected.length === 0}
            onClick={() => setFilter({ maps: [] })}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-muted hover:text-ink disabled:opacity-50"
          >
            Clear
          </button>
        </SelectList>
      )}
    </>
  );
}

function VersionSelect() {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const { facets, installedVersion } = useContext(FilterMenuDataContext);
  const { anchorRef, open, setOpen, close } = useSelectList();

  return (
    <>
      <SelectRow
        label="Game version"
        value={filter.version ?? "Any"}
        active={filter.version !== null}
        open={open}
        onClick={() => setOpen(!open)}
        anchorRef={anchorRef}
      />
      {open && (
        <SelectList anchorRef={anchorRef} label="Game versions" onClose={close}>
          <VersionOptions
            facets={facets}
            installedVersion={installedVersion}
            picked={filter.version}
            onPick={(version) => pickVersion(version, setFilter, close)}
          />
        </SelectList>
      )}
    </>
  );
}

export function VersionOptions({
  facets,
  installedVersion,
  picked,
  onPick,
}: {
  facets: FilterFacets | null;
  installedVersion: string | null;
  picked: string | null;
  onPick: (version: string | null) => void;
}) {
  return (
    <>
      <OptionRow selected={picked === null} onClick={() => onPick(null)}>
        <span className="flex-1 truncate">All versions</span>
      </OptionRow>
      {installedVersion !== null && (
        <OptionRow
          selected={picked === installedVersion}
          ariaLabel="Same as mine"
          onClick={() => onPick(installedVersion)}
        >
          <span className="min-w-0 flex-1 truncate">
            Same as mine{" "}
            <span className="[font-family:var(--t-type-family-data)] text-muted">{installedVersion}</span>
          </span>
          {facets?.same_as_mine != null && (
            <span data-part="count" className="[font-family:var(--t-type-family-data)] text-muted">
              {countText(facets.same_as_mine)}
            </span>
          )}
        </OptionRow>
      )}
      {(facets?.versions.length ?? 0) > 0 && <PopupSeparator />}
      {(facets?.versions ?? []).map((row) => (
        <OptionRow key={row.name} selected={picked === row.name} onClick={() => onPick(row.name)}>
          <span className="min-w-0 flex-1 truncate [font-family:var(--t-type-family-data)]">{row.name}</span>
          <span data-part="count" className="[font-family:var(--t-type-family-data)] text-muted">
            {countText(row.count)}
          </span>
        </OptionRow>
      ))}
    </>
  );
}

function CountrySelect() {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const { anchorRef, open, setOpen, close } = useSelectList();
  const selected = filter.countries ?? [];

  return (
    <>
      <SelectRow
        label="Country"
        value={regionDisplayValue(selected)}
        active={selected.length > 0}
        open={open}
        onClick={() => setOpen(!open)}
        anchorRef={anchorRef}
      />
      {open && (
        <SelectList anchorRef={anchorRef} label="Countries" multiselect onClose={close}>
          {REGIONS.map((region) => (
            <OptionRow
              key={region.code}
              selected={selected.includes(region.code)}
              onClick={() => setFilter({ countries: toggleInList(selected, region.code) })}
            >
              <span className="truncate">{region.label}</span>
            </OptionRow>
          ))}
        </SelectList>
      )}
    </>
  );
}

type GroupProps = { className?: string; style?: CSSProperties };

function FilterServerGroup({ className, style }: GroupProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  return (
    <Group element="popup.filterServer" heading="Server" className={className} style={style}>
      <MapSelect />
      <VersionSelect />
      <CountrySelect />
      <SegmentRow
        label="Server type"
        value={filter.official}
        choices={SERVER_TYPE}
        onPick={(official) => setFilter({ official })}
      />
    </Group>
  );
}

function FilterConnectionGroup({ className, style }: GroupProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  return (
    <Group element="popup.filterConnection" heading="Connection" className={className} style={style}>
      <SegmentRow
        label="Ping (ms)"
        value={filter.max_ping}
        choices={PING}
        onPick={(max_ping) => setFilter({ max_ping })}
      />
      <CheckRow
        label="Hide offline servers"
        hint="Servers that stopped answering"
        checked={filter.hide_offline}
        onToggle={() => setFilter({ hide_offline: !filter.hide_offline })}
      />
    </Group>
  );
}

function FilterGameplayGroup({ className, style }: GroupProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  return (
    <Group element="popup.filterGameplay" heading="Gameplay" className={className} style={style}>
      <SegmentRow
        label="Perspective"
        value={filter.first_person}
        choices={PERSPECTIVE}
        onPick={(first_person) => setFilter({ first_person })}
      />
      <SegmentRow
        label="Time of day"
        value={filter.time_of_day}
        choices={TIME_OF_DAY}
        onPick={(time_of_day) => setFilter({ time_of_day })}
      />
    </Group>
  );
}

function FilterModsGroup({ className, style }: GroupProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const { close } = useContext(FilterMenuDataContext);
  const { openModFilter } = useElementContext();
  const included = filter.mod_ids.length;
  const excluded = filter.mod_ids_exclude.length;
  const picked = included + excluded;

  return (
    <Group element="popup.filterMods" heading="Mods" className={className} style={style}>
      <SegmentRow
        label="Mods"
        hideLabel
        value={filter.modded}
        choices={MODS}
        onPick={(modded) => setFilter({ modded })}
      />
      <button
        type="button"
        data-part="select"
        data-state={picked > 0 ? "on" : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          close();
          openModFilter();
        }}
        className="flex h-7 items-center gap-1.5 border border-line bg-surface2 px-2.5 text-left text-ink data-[state~=on]:border-accent-line"
      >
        <span className="flex-1 truncate">Mods…</span>
        <span data-part="count" className="[font-family:var(--t-type-family-data)] text-muted">
          {picked === 0 ? "none picked" : modsFilterValue(included, excluded)}
        </span>
        <ChevronRight data-part="chevron" className="size-3 shrink-0 text-muted2" />
      </button>
    </Group>
  );
}

function FilterAccessGroup({ className, style }: GroupProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  return (
    <Group element="popup.filterAccess" heading="Access" className={className} style={style}>
      <CheckRow
        label="No password"
        checked={filter.hide_locked}
        onToggle={() => setFilter({ hide_locked: !filter.hide_locked })}
      />
      <CheckRow
        label="BattlEye on"
        hint="The anti-cheat DayZ uses"
        checked={filter.battleye === true}
        onToggle={() => setFilter({ battleye: filter.battleye === true ? null : true })}
      />
    </Group>
  );
}

function FilterPlayersGroup({ className, style }: GroupProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  return (
    <Group element="popup.filterPlayers" heading="Players" className={className} style={style}>
      <CheckRow
        label="Hide empty servers"
        checked={filter.hide_empty}
        onToggle={() => setFilter({ hide_empty: !filter.hide_empty })}
      />
      <CheckRow
        label="Hide full servers"
        checked={filter.hide_full}
        onToggle={() => setFilter({ hide_full: !filter.hide_full })}
      />
    </Group>
  );
}

function footerCount(facets: FilterFacets | null, failed: boolean): string {
  if (facets) return facets.total.toLocaleString("en");
  return failed ? "Couldn't count servers" : "…";
}

function FilterFooter({ className, style }: GroupProps) {
  const { facets, facetError } = useContext(FilterMenuDataContext);

  return (
    <div
      data-el="popup.filterFooter"
      data-part="footer"
      className={className ?? "flex flex-none items-center justify-between border-t border-line px-4 py-2 text-muted2"}
      style={style}
    >
      <span data-part="total">
        <span data-part="count" className="[font-family:var(--t-type-family-data)] text-ink">
          {footerCount(facets, facetError)}
        </span>
        {facetError ? "" : " servers match"}
      </span>
      <button
        type="button"
        data-part="reset"
        onClick={resetKeepingSearch}
        className="px-2.5 py-1 font-semibold uppercase text-ink"
      >
        Reset filters
      </button>
    </div>
  );
}

function FilterMenuBody({ narrow }: { narrow: boolean }) {
  return (
    <>
      <div
        data-part="body"
        data-state={narrow ? "narrow" : undefined}
        className={narrow ? "grid min-h-0 grid-cols-1 overflow-y-auto" : "grid min-h-0 grid-cols-2 overflow-y-auto"}
      >
        <div data-part="column" className="grid content-start">
          <FilterServerGroup />
          <FilterConnectionGroup />
        </div>
        <div data-part="column" className="grid content-start">
          <FilterGameplayGroup />
          <FilterModsGroup />
          <FilterAccessGroup />
          <FilterPlayersGroup />
        </div>
      </div>
      <FilterFooter />
    </>
  );
}

/** The popup itself: it carries the placement and its max height, clips, and scrolls the body inside. */
export function FilterMenuPopup({
  popupRef,
  popupStyle,
  narrow,
  width,
  left,
}: {
  popupRef: RefObject<HTMLDivElement | null>;
  popupStyle: CSSProperties;
  narrow: boolean;
  width: number;
  left?: number;
}) {
  return (
    <div
      ref={popupRef}
      data-part="popup"
      role="dialog"
      aria-label="Filters"
      className="flex flex-col overflow-hidden border border-line bg-surface shadow-lg"
      style={{ ...popupStyle, ...(left === undefined ? {} : { left }), width }}
    >
      <FilterMenuBody narrow={narrow} />
    </div>
  );
}

export function FilterMenu({
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
  const label = (options?.label as string) ?? "Filters";
  const viewportWidth = useViewportWidth();
  const { themedPopup, open, setOpen, close, ref, popupRef, popupStyle } = useThemedPopupTrigger(
    "filterMenu",
    { side: "bottom", align: "start" },
  );
  const { facets, facetError, installedVersion } = useFilterFacets(open);
  const count = activeFilterCount(filter);
  const tabNote = filter.favourites_only || filter.recent_only;

  if (tabNote) {
    return (
      <div
        data-el="filter.menu"
        data-state="tabNote"
        className={className ?? "flex items-center px-[var(--t-space-controlCompactX)] py-[var(--t-space-controlCompactY)] text-muted"}
        style={style}
      >
        <span data-part="note">Filters only apply to All servers</span>
      </div>
    );
  }

  const narrow = viewportWidth > 0 && viewportWidth < NARROW_MENU_WIDTH;
  const width = narrow ? Math.max(0, viewportWidth - MENU_SCREEN_PAD * 2) : MENU_WIDE_WIDTH;
  const left = narrow ? MENU_SCREEN_PAD : undefined;

  const states = [count > 0 && "active", open && "open"].filter(Boolean) as string[];

  return (
    <div
      ref={ref}
      data-el="filter.menu"
      data-state={states.length > 0 ? states.join(" ") : undefined}
      className={className ?? "relative flex items-center gap-1.5 border border-line bg-surface2 px-[var(--t-space-controlCompactX)] py-[var(--t-space-controlCompactY)] [font-size:var(--t-type-size-lg)] leading-4 text-ink transition-colors hover:border-accent"}
      style={style}
    >
      <button
        type="button"
        data-part="trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 border-0 bg-transparent p-0 [font:inherit] [color:inherit]"
      >
        {showLabel && (
          <span data-part="label" className="[font-size:inherit] [font-weight:inherit]">
            {label}
          </span>
        )}
        {count > 0 && (
          <span
            data-part="badge"
            className="grid min-w-[18px] place-items-center rounded-full bg-accent px-1.5 text-bg [font-family:var(--t-type-family-data)] [font-size:var(--t-type-size-sm)]"
          >
            {count}
          </span>
        )}
        <ChevronDown data-part="chevron" className="size-3 text-muted" />
      </button>
      <FilterMenuDataContext.Provider value={{ facets, facetError, installedVersion, close }}>
        <TriggerPopup open={open} popupId="filterMenu" close={close} themedPopup={themedPopup} triggerRef={ref}>
          <FilterMenuPopup
            popupRef={popupRef}
            popupStyle={popupStyle}
            narrow={narrow}
            width={width}
            left={left}
          />
        </TriggerPopup>
      </FilterMenuDataContext.Provider>
    </div>
  );
}

/** Every `popup.filter*` element a themed `layout/popups/filterMenu.json` can place. */
export function renderFilterMenuElement(
  node: ElementNode,
  { className, style }: { className?: string; style?: CSSProperties },
): ReactNode | undefined {
  switch (node.element) {
    case "popup.filterServer":
      return <FilterServerGroup className={className} style={style} />;
    case "popup.filterConnection":
      return <FilterConnectionGroup className={className} style={style} />;
    case "popup.filterGameplay":
      return <FilterGameplayGroup className={className} style={style} />;
    case "popup.filterMods":
      return <FilterModsGroup className={className} style={style} />;
    case "popup.filterAccess":
      return <FilterAccessGroup className={className} style={style} />;
    case "popup.filterPlayers":
      return <FilterPlayersGroup className={className} style={style} />;
    case "popup.filterFooter":
      return <FilterFooter className={className} style={style} />;
    default:
      return undefined;
  }
}
