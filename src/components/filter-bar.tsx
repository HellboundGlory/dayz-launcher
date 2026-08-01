import { useState, useEffect, useRef } from "react";
import { Search, ChevronDown, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";
import { getMapList } from "@/lib/tauri";

interface FilterBarProps {
  onRefresh: () => void;
  onDiscover: () => void;
  refreshing: boolean;
  discovering: boolean;
}

type TagOption = { key: string; label: string; field: "official" | "modded" | "first_person" };

const TAG_OPTIONS: TagOption[] = [
  { key: "official", label: "OFFICIAL", field: "official" },
  { key: "modded", label: "MODDED", field: "modded" },
  { key: "first_person", label: "1PP ONLY", field: "first_person" },
];

export function FilterBar({ onRefresh, onDiscover, refreshing, discovering }: FilterBarProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);

  return (
    <div className="flex items-center gap-2 border-b border-[#1e293b] bg-[#0b0f17] px-3 py-1.5">
      {/* Search */}
      <div className="relative flex-1 max-w-[240px]">
        <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-[#64748b]" />
        <input
          type="text"
          placeholder="Search name or description"
          value={filter.search ?? ""}
          onChange={(e) => setFilter({ search: e.target.value || null })}
          className="w-full rounded bg-[#16202e] py-1 pl-7 pr-2 text-xs text-[#f1f5f9] placeholder-[#64748b] outline-none ring-1 ring-[#1e293b] focus:ring-[#38bdf8]"
        />
      </div>

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

      {/* Refresh button */}
      <button
        onClick={onRefresh}
        disabled={refreshing || discovering}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
          refreshing || discovering
            ? "cursor-not-allowed text-[#475569]"
            : "bg-[#38bdf8] text-[#0b0f17] hover:bg-[#7dd3fc]",
        )}
        title="Refresh live server data"
      >
        <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        {refreshing ? "REFRESHING..." : "REFRESH"}
      </button>
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMapList()
      .then(setMaps)
      .catch(() => setMaps([]));
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
  onChange,
}: {
  official: boolean | null;
  modded: boolean | null;
  firstPerson: boolean | null;
  onChange: (field: string, value: boolean | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const activeCount = [official, modded, firstPerson].filter((v) => v === true).length;
  const label = activeCount === 0 ? "Any" : `${activeCount} tag${activeCount > 1 ? "s" : ""}`;

  const getValue = (field: string): boolean | null => {
    if (field === "official") return official;
    if (field === "modded") return modded;
    if (field === "first_person") return firstPerson;
    return null;
  };

  const cycle = (field: string) => {
    const cur = getValue(field);
    if (cur === null) onChange(field, true);
    else if (cur === true) onChange(field, false);
    else onChange(field, null);
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
        <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded border border-[#1e293b] bg-[#111823] shadow-xl">
          {TAG_OPTIONS.map((opt) => {
            const val = getValue(opt.field);
            return (
              <button
                key={opt.key}
                onClick={() => cycle(opt.field)}
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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
  const isUnlimited = maxPing >= SLIDER_MAX || maxPing === 500;

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