import { useCallback, useEffect, useRef, useState } from "react";
import { Search, ChevronDown, RefreshCw, RotateCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";
import type { SortKey } from "@/types/filters";

interface FilterBarProps {
  onRefresh: () => void;
  refreshing: boolean;
}

/**
 * The tri-state tag filters — all `ServerFilter` keys, all ordinary view state
 * that resets with the window.
 */
type TagField = "official" | "modded" | "first_person";

const TAG_OPTIONS: { label: string; field: TagField; title?: string }[] = [
  { label: "Official", field: "official" },
  { label: "Modded", field: "modded" },
  { label: "First person", field: "first_person" },
];

const REGIONS: { code: string; label: string }[] = [
  { code: "EU", label: "Europe" },
  { code: "NA", label: "North America" },
  { code: "AS", label: "Asia" },
  { code: "OC", label: "Oceania" },
  { code: "SA", label: "South America" },
];

const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: "players", label: "Players" },
  { key: "ping", label: "Ping" },
  { key: "mod_count", label: "Mods" },
  { key: "name", label: "Name" },
  { key: "map", label: "Map" },
];

/**
 * Close a popover when a pointer goes down anywhere outside it.
 *
 * The dropdowns each carried their own byte-identical copy of this effect.
 * Bound only while the popover is open, so a closed dropdown no longer keeps a
 * document-level listener alive.
 */
function useCloseOnOutsideClick(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  return ref;
}

/**
 * How long typing has to pause before the list is re-queried.
 *
 * Every change to `filter` re-runs `get_server_list` — a fresh SQL query with a
 * `LIKE '%…%'` over the whole table, up to 5000 rows marshalled across the IPC
 * bridge, and a re-render. Long enough to collapse a burst of typing, short
 * enough that the result still feels like it arrives as you type.
 */
const SEARCH_DEBOUNCE_MS = 250;

export function FilterBar({ onRefresh, refreshing }: FilterBarProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const resetFilter = useServerStore((s) => s.resetFilter);
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const setSort = useServerStore((s) => s.setSort);

  return (
    <div className="filterbar flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2.5 py-2">
      <SearchInput value={filter.search} onChange={(search) => setFilter({ search })} />

      <MapDropdown selectedMaps={filter.maps ?? []} onChange={(maps) => setFilter({ maps })} />

      <TagsDropdown
        official={filter.official}
        modded={filter.modded}
        firstPerson={filter.first_person}
        onChange={(field, value) => setFilter({ [field]: value })}
      />

      <CountryDropdown
        selectedCountries={filter.countries ?? []}
        onChange={(countries) => setFilter({ countries })}
      />

      <SortDropdown
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(key) => setSort(key, sortKey === key && sortDir === "desc" ? "asc" : "desc")}
      />

      <PingSlider maxPing={filter.max_ping ?? 500} onChange={(max_ping) => setFilter({ max_ping })} />

      {/* Reset filters.
          Filters now persist between sessions, so a restart no longer clears
          them — this is the explicit way back to defaults. */}
      <button
        onClick={resetFilter}
        className="fbtn flex shrink-0 items-center gap-1 rounded-[6px] border border-line bg-surface2 px-2 py-[5px] text-[10px] font-bold uppercase tracking-wider text-muted transition-colors hover:text-ink"
        title="Reset all filters to defaults"
      >
        <RotateCcw className="size-3" />
        Reset
      </button>

      {/* Refresh button.
          Gated on `refreshing` alone, not `discovering`: discovery streams
          rows into the table as Steam reports them, so there can already be
          servers on screen worth re-probing well before the Steam walk
          finishes. */}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className={cn(
          "fbtn flex shrink-0 items-center justify-center gap-1 rounded-[6px] border px-2 py-[5px] text-[10px] font-bold uppercase tracking-wider transition-colors",
          refreshing
            ? "cursor-not-allowed border-line bg-surface2 text-muted"
            : "border-accent-line bg-accent-soft text-accent shadow-[var(--glow)] hover:brightness-110",
        )}
        title="Re-probe the servers currently on screen — ping, lock, mods, online status"
      >
        <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

// ─── Search ──────────────────────────────────────────────────────

/**
 * Search box that keeps its own text and reports it on a trailing debounce.
 *
 * The input is uncontrolled with respect to the store deliberately: driving it
 * from `filter.search` would make every keystroke wait for the debounced round
 * trip before the character appeared, which is the one thing a search box must
 * never do.
 */
function SearchInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (search: string | null) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Re-sync when the store's value changes from somewhere other than this box
  // (a filter reset, say). Comparing first keeps this from clobbering in-flight
  // typing with the value it just published.
  useEffect(() => {
    setText((current) => (current === (value ?? "") ? current : value ?? ""));
  }, [value]);

  useEffect(() => {
    const next = text.trim() || null;
    if (next === (value ?? null)) return;
    const timer = window.setTimeout(() => onChangeRef.current(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="search flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] border border-line bg-surface2 px-2.5 py-[5px]">
      <Search className="size-3 shrink-0 text-muted" />
      <input
        type="text"
        placeholder="Search servers…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Search servers"
        className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-muted"
      />
    </div>
  );
}

// ─── Dropdown vocabulary (`.fdrop`) ──────────────────────────────

function FdropMenu({ children }: { children: React.ReactNode }) {
  return (
    <div className="fdrop-menu absolute left-0 top-[calc(100%+5px)] z-30 min-w-[190px] rounded-[7px] border border-line bg-surface2 p-[5px] shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
      {children}
    </div>
  );
}

function FdropItem({
  active,
  onClick,
  icon,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      role="option"
      aria-selected={active}
      className={cn(
        "flex w-full items-center gap-2 whitespace-nowrap rounded-[5px] px-2 py-1.5 text-[10px] font-semibold text-muted2 transition-colors hover:bg-surface hover:text-ink",
        active && "bg-accent-soft text-accent",
      )}
    >
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center text-muted">
        {icon ?? <Check className={cn("size-3", !active && "opacity-0")} strokeWidth={2} />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function FdropClear({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-[7px] rounded-[5px] px-2 py-[5px] text-[8px] font-bold uppercase tracking-[0.05em] text-muted transition-colors hover:bg-surface hover:text-ink"
    >
      Clear
    </button>
  );
}

function FdropSep() {
  return <div className="mx-0.5 my-1 h-px bg-line" />;
}

function FdropTrigger({
  label,
  on,
  open,
  children,
  onClick,
  title,
}: {
  label: string;
  on?: boolean;
  open?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-haspopup="listbox"
      aria-expanded={open ?? false}
      className={cn(
        "fdrop-trigger flex items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-line bg-surface2 px-2 py-[5px] text-[10px] font-bold text-muted transition-colors hover:border-accent-line hover:text-ink",
        on && "border-accent-line bg-accent-soft text-accent shadow-[var(--glow)]",
      )}
    >
      <span>{label}</span>
      <span className={cn("truncate font-semibold text-muted2", on && "text-accent")}>
        {children}
      </span>
      <ChevronDown className="size-[11px] text-muted" />
    </button>
  );
}

// ─── Map Dropdown ────────────────────────────────────────────────

function MapDropdown({
  selectedMaps,
  onChange,
}: {
  selectedMaps: string[];
  onChange: (maps: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const maps = useServerStore((s) => s.maps);
  const ref = useCloseOnOutsideClick(open, useCallback(() => setOpen(false), []));

  const label =
    selectedMaps.length === 0
      ? "Any"
      : selectedMaps.length === 1
        ? maps.find(([normalised]) => normalised === selectedMaps[0])?.[1] ?? selectedMaps[0]
        : `${selectedMaps.length} maps`;

  const toggle = (normalised: string) => {
    if (selectedMaps.includes(normalised)) {
      onChange(selectedMaps.filter((m) => m !== normalised));
    } else {
      onChange([...selectedMaps, normalised]);
    }
  };

  return (
    <div ref={ref} className={cn("fdrop relative", open && "open")}>
      <FdropTrigger label="MAP" on={selectedMaps.length > 0} open={open} onClick={() => setOpen(!open)}>
        {label}
      </FdropTrigger>
      {open && (
        <FdropMenu>
          {maps.length === 0 && (
            <div className="px-2 py-1.5 text-[10px] text-muted">Loading maps...</div>
          )}
          {maps.map(([normalised, display]) => (
            <FdropItem
              key={normalised}
              active={selectedMaps.includes(normalised)}
              onClick={() => toggle(normalised)}
            >
              {display}
            </FdropItem>
          ))}
          <FdropSep />
          <FdropClear onClick={() => onChange([])} />
        </FdropMenu>
      )}
    </div>
  );
}

// ─── Tags Dropdown ───────────────────────────────────────────────

function TagsDropdown({
  official,
  modded,
  firstPerson,
  onChange,
}: {
  official: boolean | null;
  modded: boolean | null;
  firstPerson: boolean | null;
  onChange: (field: TagField, value: boolean | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick(open, useCallback(() => setOpen(false), []));

  const values: Record<TagField, boolean | null> = {
    official,
    modded,
    first_person: firstPerson,
  };

  // Any non-null state counts: excluding is as much a choice as including, and
  // a "✗ 1PP" filter with the chip reading "Any" would be a lie.
  const activeCount = Object.values(values).filter((v) => v !== null).length;
  const label = activeCount === 0 ? "Any" : `${activeCount} tag${activeCount > 1 ? "s" : ""}`;

  // include -> exclude -> don't care.
  const cycle = (field: TagField) => {
    const cur = values[field];
    onChange(field, cur === null ? true : cur === true ? false : null);
  };

  const indicator = (val: boolean | null): string => {
    if (val === true) return "✓";
    if (val === false) return "✗";
    return "";
  };

  const indicatorColor = (val: boolean | null): string => {
    if (val === true) return "text-success";
    if (val === false) return "text-danger";
    return "text-muted";
  };

  return (
    <div ref={ref} className={cn("fdrop relative", open && "open")}>
      <FdropTrigger label="TAGS" on={activeCount > 0} open={open} onClick={() => setOpen(!open)}>
        {label}
      </FdropTrigger>
      {open && (
        <FdropMenu>
          {TAG_OPTIONS.map((opt) => {
            const val = values[opt.field];
            return (
              <FdropItem key={opt.field} active={val === true} onClick={() => cycle(opt.field)}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("font-mono-data text-[10px]", indicatorColor(val))}>
                    {indicator(val)}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </span>
              </FdropItem>
            );
          })}
          <FdropSep />
          <FdropClear
            onClick={() => {
              onChange("official", null);
              onChange("modded", null);
              onChange("first_person", null);
            }}
          />
        </FdropMenu>
      )}
    </div>
  );
}

// ─── Country Dropdown ────────────────────────────────────────────

function CountryDropdown({
  selectedCountries,
  onChange,
}: {
  selectedCountries: string[];
  onChange: (countries: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick(open, useCallback(() => setOpen(false), []));

  const label =
    selectedCountries.length === 0
      ? "Any"
      : selectedCountries.length === 1
        ? REGIONS.find((r) => r.code === selectedCountries[0])?.label ?? selectedCountries[0]
        : `${selectedCountries.length} regions`;

  const toggle = (code: string) => {
    if (selectedCountries.includes(code)) {
      onChange(selectedCountries.filter((c) => c !== code));
    } else {
      onChange([...selectedCountries, code]);
    }
  };

  return (
    <div ref={ref} className={cn("fdrop relative", open && "open")}>
      <FdropTrigger
        label="REGION"
        on={selectedCountries.length > 0}
        open={open}
        onClick={() => setOpen(!open)}
        title="Approximate — based on the server's IP block, not its actual location"
      >
        {label}
      </FdropTrigger>
      {open && (
        <FdropMenu>
          {REGIONS.map((region) => (
            <FdropItem
              key={region.code}
              active={selectedCountries.includes(region.code)}
              onClick={() => toggle(region.code)}
            >
              {region.label}
            </FdropItem>
          ))}
          <FdropSep />
          {/* L1 (2026-08-29 audit): the classifier is a first-octet table —
              a whole /8 per region, and nine octets are contested between
              two regions with "last block wins". Real, but coarse enough
              that presenting it as fact would mislead; this says so. */}
          <p className="px-2 pb-1 pt-0.5 text-[8px] leading-snug text-muted">
            Approximate — based on IP block, not confirmed location
          </p>
          <FdropClear onClick={() => onChange([])} />
        </FdropMenu>
      )}
    </div>
  );
}

// ─── Sort Dropdown ───────────────────────────────────────────────

function SortDropdown({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick(open, useCallback(() => setOpen(false), []));

  const current = SORT_KEYS.find((s) => s.key === sortKey);
  const label = `${current?.label ?? "Players"} ${sortDir === "desc" ? "↓" : "↑"}`;

  return (
    <div ref={ref} className={cn("fdrop relative", open && "open")}>
      <FdropTrigger
        label="SORT"
        on={!(sortKey === "players" && sortDir === "desc")}
        open={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </FdropTrigger>
      {open && (
        <FdropMenu>
          {SORT_KEYS.map((s) => (
            <FdropItem
              key={s.key}
              active={sortKey === s.key}
              onClick={() => onSort(s.key)}
            >
              {s.label}
            </FdropItem>
          ))}
        </FdropMenu>
      )}
    </div>
  );
}

// ─── Ping Slider ─────────────────────────────────────────────────

function PingSlider({
  maxPing,
  onChange,
}: {
  maxPing: number;
  onChange: (maxPing: number | null) => void;
}) {
  const SLIDER_MAX = 500;
  const sliderValue = maxPing >= SLIDER_MAX ? SLIDER_MAX : Math.max(50, maxPing);
  // At the top of the range the filter is cleared entirely (`onChange(null)`)
  // rather than capped at 500ms.
  const isUnlimited = maxPing >= SLIDER_MAX;

  return (
    <div className="ping-row flex shrink-0 items-center gap-1.5 px-0.5 text-[10px] text-muted">
      <span className="font-bold uppercase tracking-[0.05em] text-muted2">PING</span>
      <input
        type="range"
        min={50}
        max={SLIDER_MAX}
        step={10}
        value={sliderValue}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(v >= SLIDER_MAX ? null : v);
        }}
        aria-label="Maximum ping"
        className="h-[3px] w-14 cursor-pointer appearance-none rounded-full bg-line accent-accent"
      />
      <span className="w-9 font-mono-data text-muted2">
        {isUnlimited ? "Any" : `${sliderValue}ms`}
      </span>
    </div>
  );
}
