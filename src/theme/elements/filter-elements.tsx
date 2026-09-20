import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Search, RefreshCw, RotateCcw, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";

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
    setText(filter.search ?? "");
  }, [filter.search]);

  useEffect(() => {
    const next = text.trim() || null;
    if (next === (filter.search ?? null)) return;
    const timer = window.setTimeout(() => setFilter({ search: next }), 250);
    return () => clearTimeout(timer);
  }, [text, filter.search, setFilter]);

  return (
    <div
      data-el="filter.search"
      className={className ?? "flex items-center gap-2 border border-border bg-surface2 px-2.5 py-1 text-sm text-text"}
      style={style}
    >
      {showIcon && <Search className="size-3.5 text-muted shrink-0" />}
      <input
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
  const setFilter = useServerStore((s) => s.setFilter);
  const maps = useServerStore((s) => s.maps);
  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string) ?? "MAP";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const mapName = filter.maps && filter.maps.length > 0
    ? (maps.find(([norm]) => norm === filter.maps![0])?.[1] ?? filter.maps[0])
    : "Any";

  return (
    <div ref={ref} className="relative" style={style}>
      <button
        type="button"
        data-el="filter.map"
        onClick={() => setOpen(!open)}
        className={className ?? "flex items-center gap-1.5 border border-border bg-surface2 px-2.5 py-1 text-xs text-text transition-colors hover:border-accent"}
      >
        {showLabel && <span className="text-muted text-[10px] font-bold">{label}</span>}
        <span className="font-semibold">{mapName}</span>
        <ChevronDown className="size-3 text-muted ml-0.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 max-h-60 min-w-[160px] overflow-y-auto border border-border bg-surface2 p-1 shadow-lg text-xs">
          <button
            type="button"
            onClick={() => {
              setFilter({ maps: [] });
              setOpen(false);
            }}
            className={cn(
              "w-full text-left px-2 py-1 hover:bg-surface hover:text-ink transition-colors",
              (!filter.maps || filter.maps.length === 0) && "text-accent font-semibold",
            )}
          >
            Any
          </button>
          {maps.map(([norm, disp]) => (
            <button
              key={norm}
              type="button"
              onClick={() => {
                setFilter({ maps: [norm] });
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-2 py-1 hover:bg-surface hover:text-ink transition-colors",
                filter.maps?.includes(norm) && "text-accent font-semibold",
              )}
            >
              {disp}
            </button>
          ))}
        </div>
      )}
    </div>
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
  const setFilter = useServerStore((s) => s.setFilter);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string) ?? "TAGS";

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const activeCount = (filter.official ? 1 : 0) + (filter.modded ? 1 : 0) + (filter.first_person ? 1 : 0);
  const summary = activeCount === 0 ? "Any" : activeCount === 1 ? (filter.official ? "Official" : filter.modded ? "Modded" : "1PP") : `Active (${activeCount})`;

  return (
    <div ref={ref} className="relative" style={style}>
      <button
        type="button"
        data-el="filter.tags"
        onClick={() => setOpen(!open)}
        className={className ?? "flex items-center gap-1.5 border border-border bg-surface2 px-2.5 py-1 text-xs text-text transition-colors hover:border-accent"}
      >
        {showLabel && <span className="text-muted text-[10px] font-bold">{label}</span>}
        <span className="font-semibold">{summary}</span>
        <ChevronDown className="size-3 text-muted ml-0.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[140px] border border-border bg-surface2 p-1.5 shadow-lg text-xs space-y-1">
          <label className="flex items-center gap-2 px-1 py-0.5 hover:bg-surface cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(filter.official)}
              onChange={(e) => setFilter({ official: e.target.checked })}
              className="size-3"
            />
            <span>Official</span>
          </label>
          <label className="flex items-center gap-2 px-1 py-0.5 hover:bg-surface cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(filter.modded)}
              onChange={(e) => setFilter({ modded: e.target.checked })}
              className="size-3"
            />
            <span>Modded</span>
          </label>
          <label className="flex items-center gap-2 px-1 py-0.5 hover:bg-surface cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(filter.first_person)}
              onChange={(e) => setFilter({ first_person: e.target.checked })}
              className="size-3"
            />
            <span>1PP (First Person)</span>
          </label>
        </div>
      )}
    </div>
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
  const setFilter = useServerStore((s) => s.setFilter);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const label = (options?.label as string) ?? "Country";
  const regionText = filter.countries && filter.countries.length > 0 ? filter.countries.join(", ") : "Any";

  return (
    <div ref={ref} className="relative" style={style}>
      <button
        type="button"
        data-el="filter.region"
        onClick={() => setOpen(!open)}
        className={className ?? "flex items-center gap-1.5 border border-border bg-surface2 px-2.5 py-1 text-xs text-text transition-colors hover:border-accent"}
      >
        <span className="text-muted text-[10px] font-bold uppercase">{label}</span>
        <span className="font-semibold">{regionText}</span>
        <ChevronDown className="size-3 text-muted ml-0.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[140px] border border-border bg-surface2 p-1.5 shadow-lg text-xs space-y-1">
          <button
            type="button"
            onClick={() => {
              setFilter({ countries: [] });
              setOpen(false);
            }}
            className={cn(
              "w-full text-left px-2 py-1 hover:bg-surface hover:text-ink transition-colors",
              (!filter.countries || filter.countries.length === 0) && "text-accent font-semibold",
            )}
          >
            Any
          </button>
          {["DE", "US", "FR", "GB", "NL", "PL"].map((cc) => (
            <button
              key={cc}
              type="button"
              onClick={() => {
                setFilter({ countries: [cc] });
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-2 py-1 hover:bg-surface hover:text-ink transition-colors",
                filter.countries?.includes(cc) && "text-accent font-semibold",
              )}
            >
              {cc}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterMaxPing({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const maxPing = filter.max_ping ?? 80;

  return (
    <div
      data-el="filter.maxPing"
      className={className ?? "flex items-center gap-2 border border-border bg-surface2 px-2.5 py-1 text-xs text-text"}
      style={style}
    >
      <span className="text-muted text-[10px] font-bold">PING</span>
      <input
        type="range"
        min={20}
        max={300}
        step={10}
        value={maxPing}
        onChange={(e) => setFilter({ max_ping: Number(e.target.value) })}
        className="w-20 accent-accent cursor-pointer h-1.5 bg-surface rounded-none"
      />
      <span className="text-xs font-mono-data tabular-nums text-muted2 w-9">{maxPing}ms</span>
    </div>
  );
}

export function FilterHideEmpty({
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
  const label = (options?.label as string) ?? "HIDE EMPTY";
  const active = Boolean(filter.hide_empty);

  return (
    <button
      type="button"
      data-el="filter.hideEmpty"
      aria-pressed={active}
      data-state={active ? "active" : undefined}
      onClick={() => setFilter({ hide_empty: !active })}
      className={className ?? cn(
        "px-2.5 py-1 text-xs font-bold uppercase tracking-wider border transition-colors",
        active
          ? "border-accent bg-accent text-bg shadow-[0_0_6px_var(--accent)]"
          : "border-border bg-surface text-muted2 hover:text-text hover:border-border",
      )}
      style={style}
    >
      {label}
    </button>
  );
}

export function FilterHideFull({
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
  const label = (options?.label as string) ?? "HIDE FULL";
  const active = Boolean(filter.hide_full);

  return (
    <button
      type="button"
      data-el="filter.hideFull"
      aria-pressed={active}
      data-state={active ? "active" : undefined}
      onClick={() => setFilter({ hide_full: !active })}
      className={className ?? cn(
        "px-2.5 py-1 text-xs font-bold uppercase tracking-wider border transition-colors",
        active
          ? "border-accent bg-accent text-bg shadow-[0_0_6px_var(--accent)]"
          : "border-border bg-surface text-muted2 hover:text-text hover:border-border",
      )}
      style={style}
    >
      {label}
    </button>
  );
}

export function FilterHideLocked({
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
  const label = (options?.label as string) ?? "HIDE LOCKED";
  const active = Boolean(filter.hide_locked);

  return (
    <button
      type="button"
      data-el="filter.hideLocked"
      aria-pressed={active}
      data-state={active ? "active" : undefined}
      onClick={() => setFilter({ hide_locked: !active })}
      className={className ?? cn(
        "px-2.5 py-1 text-xs font-bold uppercase tracking-wider border transition-colors",
        active
          ? "border-accent bg-accent text-bg shadow-[0_0_6px_var(--accent)]"
          : "border-border bg-surface text-muted2 hover:text-text hover:border-border",
      )}
      style={style}
    >
      {label}
    </button>
  );
}

export function FilterHideOffline({
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
  const label = (options?.label as string) ?? "HIDE DEAD";
  const active = Boolean(filter.hide_offline);

  return (
    <button
      type="button"
      data-el="filter.hideOffline"
      aria-pressed={active}
      data-state={active ? "active" : undefined}
      onClick={() => setFilter({ hide_offline: !active })}
      className={className ?? cn(
        "px-2.5 py-1 text-xs font-bold uppercase tracking-wider border transition-colors",
        active
          ? "border-accent bg-accent text-bg shadow-[0_0_6px_var(--accent)]"
          : "border-border bg-surface text-muted2 hover:text-text hover:border-border",
      )}
      style={style}
    >
      {label}
    </button>
  );
}

export function ServersRefresh({
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const triggerReload = useServerStore((s) => s.triggerReload);
  const loading = useServerStore((s) => s.isLoading);

  return (
    <button
      type="button"
      data-el="servers.refresh"
      onClick={() => triggerReload()}
      disabled={loading}
      aria-label="Refresh server list"
      className={className ?? "p-1.5 border border-border bg-surface2 hover:border-accent text-muted hover:text-ink transition-colors"}
      style={style}
    >
      <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
    </button>
  );
}

export function FilterReset({
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const resetFilter = useServerStore((s) => s.resetFilter);

  return (
    <button
      type="button"
      data-el="filter.reset"
      onClick={() => resetFilter()}
      aria-label="Reset filters"
      className={className ?? "flex items-center gap-1 px-2 py-1 text-xs border border-border bg-surface2 hover:border-accent text-muted hover:text-ink transition-colors"}
      style={style}
    >
      <RotateCcw className="size-3" />
      <span className="text-[10px] font-semibold uppercase">RESET</span>
    </button>
  );
}
