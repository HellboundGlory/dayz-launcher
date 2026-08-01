import { useCallback, useEffect, useRef, useState } from "react";
import { Search, ChevronDown, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";
import { getMapList } from "@/lib/tauri";

interface FilterBarProps {
  onRefresh: () => void;
  refreshing: boolean;
}

/** The tri-state tag filters, which are exactly the boolean-or-null fields. */
type TagField = "official" | "modded" | "first_person" | "latin_names";

const TAG_OPTIONS: { label: string; field: TagField; title?: string }[] = [
  { label: "OFFICIAL", field: "official" },
  { label: "MODDED", field: "modded" },
  { label: "1PP ONLY", field: "first_person" },
  {
    label: "ENGLISH ONLY",
    field: "latin_names",
    // Tri-state earns its keep here: ✗ is how someone who *wants* the Chinese
    // or Russian servers finds them, which a plain on/off toggle could not do.
    title:
      "✓ only servers whose name reads in Latin script · ✗ only those that don't · blank shows all",
  },
];

/**
 * Close a popover when a pointer goes down anywhere outside it.
 *
 * The MAP, TAGS and REGION dropdowns each carried their own byte-identical copy
 * of this effect. Bound only while the popover is open, so a closed dropdown no
 * longer keeps a document-level listener alive.
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
 * bridge, and a re-render. Bound straight to `onChange`, that was one full round
 * trip per keystroke, so a ten-character search ran ten of them and the last one
 * to land won. Long enough to collapse a burst of typing, short enough that the
 * result still feels like it arrives as you type.
 */
const SEARCH_DEBOUNCE_MS = 250;

export function FilterBar({ onRefresh, refreshing }: FilterBarProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);

  return (
    <div className="flex items-center gap-2 border-b border-[#1e293b] bg-[#0b0f17] px-3 py-1.5">
      <SearchInput
        value={filter.search}
        onChange={(search) => setFilter({ search })}
      />

      {/* Map filter */}
      <MapDropdown
        selectedMaps={filter.maps ?? []}
        onChange={(maps) => setFilter({ maps })}
      />

      {/* Tags filter */}
      <TagsDropdown
        official={filter.official}
        modded={filter.modded}
        firstPerson={filter.first_person}
        latinNames={filter.latin_names}
        onChange={(field, value) => setFilter({ [field]: value })}
      />

      {/* Country filter */}
      <CountryDropdown
        selectedCountries={filter.countries ?? []}
        onChange={(countries) => setFilter({ countries })}
      />

      {/* Ping slider */}
      <PingSlider
        maxPing={filter.max_ping ?? 500}
        onChange={(max_ping) => setFilter({ max_ping })}
      />

      <div className="flex-1" />

      {/* Toggle buttons */}
      <div className="flex gap-1">
        <ToggleButton
          label="HIDE EMPTY"
          active={filter.hide_empty}
          onClick={() => setFilter({ hide_empty: !filter.hide_empty })}
        />
        <ToggleButton
          label="HIDE FULL"
          active={filter.hide_full}
          onClick={() => setFilter({ hide_full: !filter.hide_full })}
        />
        <ToggleButton
          label="HIDE LOCKED"
          active={filter.hide_locked}
          onClick={() => setFilter({ hide_locked: !filter.hide_locked })}
        />
      </div>

      {/* Refresh button.
          Gated on `refreshing` alone, not `discovering`: discovery streams
          rows into the table as Steam reports them (see the
          `discovery-progress` listener in App.tsx), so there can already be
          servers on screen worth re-probing well before the Steam walk
          finishes. Both commands go through the same registry writer thread,
          so nothing about running them at once is unsafe — it would just
          queue. */}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
          refreshing
            ? "cursor-not-allowed text-[#475569]"
            : "bg-[#38bdf8] text-[#0b0f17] hover:bg-[#7dd3fc]",
        )}
        title="Re-probe the servers currently on screen — ping, lock, mods, online status"
      >
        <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        {refreshing ? "REFRESHING..." : "REFRESH"}
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
    // Nothing to publish while the box already agrees with the store — this is
    // also what stops the re-sync effect above and this one from ping-ponging.
    if (next === (value ?? null)) return;
    const timer = window.setTimeout(() => onChangeRef.current(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `value` is read for the comparison but must not re-arm the timer on its
    // own — only a change to `text` should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="relative flex-1 max-w-[240px]">
      <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[#64748b]" />
      <input
        type="text"
        placeholder="Search name or description"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded bg-[#16202e] py-1 pl-7 pr-2 text-xs text-[#f1f5f9] placeholder-[#64748b] outline-none ring-1 ring-[#1e293b] focus:ring-[#38bdf8]"
      />
    </div>
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
  const [maps, setMaps] = useState<[string, string][]>([]);
  const ref = useCloseOnOutsideClick(open, useCallback(() => setOpen(false), []));

  useEffect(() => {
    getMapList()
      .then(setMaps)
      .catch(() => setMaps([]));
  }, []);

  const label = selectedMaps.length === 0
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded bg-[#16202e] px-2 py-1 text-[10px] font-semibold tracking-wider ring-1 ring-[#1e293b] hover:text-[#94a3b8]"
      >
        <span className="text-[#f1f5f9]">MAP</span>
        <span className={cn("text-[#64748b]", selectedMaps.length > 0 && "text-[#38bdf8]")}>
          {label}
        </span>
        <ChevronDown className="size-3 text-[#64748b]" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded border border-[#1e293b] bg-[#111823] shadow-xl">
          {maps.length === 0 && (
            <div className="px-2 py-1.5 text-[10px] text-[#64748b]">Loading maps...</div>
          )}
          {maps.map(([normalised, display]) => (
            <label
              key={normalised}
              className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[11px] text-[#94a3b8] hover:bg-[#16202e]"
            >
              <input
                type="checkbox"
                checked={selectedMaps.includes(normalised)}
                onChange={() => toggle(normalised)}
                className="size-3 accent-[#38bdf8]"
              />
              {display}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tags Dropdown ───────────────────────────────────────────────

function TagsDropdown({
  official,
  modded,
  firstPerson,
  latinNames,
  onChange,
}: {
  official: boolean | null;
  modded: boolean | null;
  firstPerson: boolean | null;
  latinNames: boolean | null;
  // `TagField`, not `string`: the caller spreads this straight into `setFilter`,
  // so an untyped key silently wrote a filter field that does not exist.
  onChange: (field: TagField, value: boolean | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick(open, useCallback(() => setOpen(false), []));

  const values: Record<TagField, boolean | null> = {
    official,
    modded,
    first_person: firstPerson,
    latin_names: latinNames,
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
    if (val === true) return "text-[#22c55e]";
    if (val === false) return "text-[#ef4444]";
    return "text-[#334155]";
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded bg-[#16202e] px-2 py-1 text-[10px] font-semibold tracking-wider ring-1 ring-[#1e293b] hover:text-[#94a3b8]"
      >
        <span className="text-[#f1f5f9]">TAGS</span>
        <span className={cn("text-[#64748b]", activeCount > 0 && "text-[#38bdf8]")}>
          {label}
        </span>
        <ChevronDown className="size-3 text-[#64748b]" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded border border-[#1e293b] bg-[#111823] shadow-xl">
          {TAG_OPTIONS.map((opt) => {
            const val = values[opt.field];
            return (
              <button
                key={opt.field}
                onClick={() => cycle(opt.field)}
                title={opt.title}
                className="flex w-full items-center justify-between px-2 py-1.5 text-[11px] text-[#94a3b8] hover:bg-[#16202e]"
              >
                <span>{opt.label}</span>
                <span className={cn("font-mono-data text-[10px]", indicatorColor(val))}>
                  {indicator(val)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Country Dropdown ────────────────────────────────────────────

const REGIONS: { code: string; label: string }[] = [
  { code: "EU", label: "Europe" },
  { code: "NA", label: "North America" },
  { code: "AS", label: "Asia" },
  { code: "OC", label: "Oceania" },
  { code: "SA", label: "South America" },
];

function CountryDropdown({
  selectedCountries,
  onChange,
}: {
  selectedCountries: string[];
  onChange: (countries: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useCloseOnOutsideClick(open, useCallback(() => setOpen(false), []));

  const label = selectedCountries.length === 0
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

  const clear = () => onChange([]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded bg-[#16202e] px-2 py-1 text-[10px] font-semibold tracking-wider ring-1 ring-[#1e293b] hover:text-[#94a3b8]"
      >
        <span className="text-[#f1f5f9]">REGION</span>
        <span className={cn("text-[#64748b]", selectedCountries.length > 0 && "text-[#38bdf8]")}>
          {label}
        </span>
        <ChevronDown className="size-3 text-[#64748b]" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-44 overflow-y-auto rounded border border-[#1e293b] bg-[#111823] shadow-xl">
          <button
            onClick={clear}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-[10px] font-semibold text-[#64748b] hover:bg-[#16202e]"
          >
            <X className="size-3" />
            CLEAR
          </button>
          {REGIONS.map((region) => (
            <label
              key={region.code}
              className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[11px] text-[#94a3b8] hover:bg-[#16202e]"
            >
              <input
                type="checkbox"
                checked={selectedCountries.includes(region.code)}
                onChange={() => toggle(region.code)}
                className="size-3 accent-[#38bdf8]"
              />
              {region.label}
            </label>
          ))}
        </div>
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
  // rather than capped at 500ms. The `|| maxPing === 500` this used to carry was
  // already covered by the `>=`.
  const isUnlimited = maxPing >= SLIDER_MAX;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
        PING
      </span>
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
        className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-[#1e293b] accent-[#38bdf8] [&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#38bdf8]"
      />
      <span className="font-mono-data text-[10px] text-[#f1f5f9]">
        {isUnlimited ? "Any" : `${sliderValue}ms`}
      </span>
    </div>
  );
}

// ─── Toggle Button ───────────────────────────────────────────────

function ToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider transition-colors",
        active
          ? "bg-[#38bdf8] text-[#0b0f17]"
          : "bg-[#16202e] text-[#64748b] ring-1 ring-[#1e293b] hover:text-[#94a3b8]",
      )}
    >
      {label}
    </button>
  );
}