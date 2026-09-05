import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search, Check, Star, ExternalLink, ThumbsUp, Users, Loader2, Inbox } from "lucide-react";
import { useServerStore } from "@/stores/server-store";
import { useModsStore, visibleRows } from "@/stores/mods-store";
import {
  getKnownMods,
  getModUsage,
  searchWorkshopMods,
  type KnownMod,
  type SubscribedMod,
  type WorkshopSearchResult,
} from "@/lib/tauri";
import { cn, formatBytes, formatLastPlayed } from "@/lib/utils";

type Tab = "subscribed" | "seen" | "workshop";

/** How long typing pauses before the Workshop search re-queries — same budget as the server search box. */
const SEARCH_DEBOUNCE_MS = 350;

/** One mod, whichever tab it came from, in the shape the list row and preview pane render. */
interface Entry {
  id: string;
  title: string;
  previewUrl: string | null;
  subscribed: boolean;
  serverCount: number | null;
  description: string | null;
  tags: string[];
  numSubscriptions: string | null;
  score: number | null;
  fileSize: number | null;
  timeUpdated: number | null;
  workshopUrl: string | null;
}

function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** A real Workshop thumbnail, falling back to a generated initials tile — for a mod
    the registry only knows the id and name of, or whose image failed to load. */
function ModThumb({ id, title, previewUrl, className }: { id: string; title: string; previewUrl: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (previewUrl && !broken) {
    return (
      <img
        src={previewUrl}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  const hue = hashHue(id);
  return (
    <div
      className={cn("flex h-full w-full items-center justify-center font-extrabold text-white/85", className)}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 42% 32%), hsl(${(hue + 42) % 360} 48% 20%))`,
      }}
    >
      {initials(title)}
    </div>
  );
}

interface ModFilterModalProps {
  onClose: () => void;
}

// "Filter by mod" modal, opened from the filter bar's MODS trigger. Three
// pools — Subscribed / Seen on servers / Search Workshop — feeding one
// split list+preview layout. Focus trapped; Escape, ✕ and backdrop close
// without applying, same contract as ServerInfoModal.
export function ModFilterModal({ onClose }: ModFilterModalProps) {
  const filter = useServerStore((s) => s.filter);
  const setFilter = useServerStore((s) => s.setFilter);
  const modsRows = useModsStore((s) => s.rows);
  const modsLoading = useModsStore((s) => s.loading);
  const loadSubscribedMods = useModsStore((s) => s.load);

  const [tab, setTab] = useState<Tab>("subscribed");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string[]>(filter.mod_ids);
  const [mode, setMode] = useState<"any" | "all">(filter.mod_match);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, { title: string; previewUrl: string | null }>>({});

  const [known, setKnown] = useState<KnownMod[] | null>(null);
  const [knownLoading, setKnownLoading] = useState(false);

  const [searchResults, setSearchResults] = useState<WorkshopSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [usage, setUsage] = useState<Record<string, number>>({});

  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSubscribedMods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setKnownLoading(true);
    getKnownMods()
      .then((rows) => {
        if (!cancelled) setKnown(rows);
      })
      .catch(() => {
        if (!cancelled) setKnown([]);
      })
      .finally(() => {
        if (!cancelled) setKnownLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    joinFocus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function joinFocus() {
    wrapRef.current?.querySelector<HTMLElement>("input")?.focus();
  }

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const els = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((el) => !el.hasAttribute("disabled"));
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function closeIfOutside(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const subscribedForDayz = useMemo(
    () =>
      visibleRows(modsRows)
        .filter((m) => m.for_dayz)
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
    [modsRows],
  );
  const subscribedIds = useMemo(() => new Set(subscribedForDayz.map((m) => m.workshop_id)), [subscribedForDayz]);

  useEffect(() => {
    setPreviewId(null);
    setSearchError(null);
  }, [tab]);

  // Debounced Workshop text search — only the "workshop" tab drives it, and
  // it stays empty (a prompt, not a list) until the user actually types.
  useEffect(() => {
    if (tab !== "workshop") return;
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      searchWorkshopMods(q)
        .then((rows) => {
          setSearchResults(rows);
          setSearchError(null);
        })
        .catch((e) => {
          setSearchResults([]);
          setSearchError(String(e));
        })
        .finally(() => setSearchLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tab, query]);

  function fromSubscribed(m: SubscribedMod): Entry {
    return {
      id: m.workshop_id,
      title: m.title || `Workshop item ${m.workshop_id}`,
      previewUrl: m.preview_url,
      subscribed: true,
      serverCount: usage[m.workshop_id] ?? null,
      description: m.description,
      tags: m.tags,
      numSubscriptions: m.num_subscriptions || null,
      score: m.score || null,
      fileSize: m.file_size || null,
      timeUpdated: m.time_updated || null,
      workshopUrl: m.workshop_url,
    };
  }
  function fromKnown(m: KnownMod): Entry {
    return {
      id: m.workshop_id,
      title: m.name || `Workshop item ${m.workshop_id}`,
      previewUrl: null,
      subscribed: subscribedIds.has(m.workshop_id),
      serverCount: m.server_count,
      description: null,
      tags: [],
      numSubscriptions: null,
      score: null,
      fileSize: null,
      timeUpdated: null,
      workshopUrl: null,
    };
  }
  function fromSearch(m: WorkshopSearchResult): Entry {
    return {
      id: m.workshop_id,
      title: m.title,
      previewUrl: m.preview_url,
      subscribed: subscribedIds.has(m.workshop_id),
      serverCount: usage[m.workshop_id] ?? null,
      description: m.description || null,
      tags: m.tags,
      numSubscriptions: m.num_subscriptions,
      score: m.score,
      fileSize: m.file_size,
      timeUpdated: m.time_updated,
      workshopUrl: m.workshop_url,
    };
  }

  const activeList: Entry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === "subscribed") {
      return subscribedForDayz.filter((m) => !q || (m.title ?? "").toLowerCase().includes(q)).map(fromSubscribed);
    }
    if (tab === "seen") {
      return (known ?? []).filter((m) => !q || m.name.toLowerCase().includes(q)).map(fromKnown);
    }
    return searchResults.map(fromSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query, subscribedForDayz, known, searchResults, usage, subscribedIds]);

  // Server counts for tabs whose source doesn't already carry one ("seen"
  // gets it straight from the registry query).
  useEffect(() => {
    const ids =
      tab === "subscribed"
        ? subscribedForDayz.map((m) => m.workshop_id)
        : tab === "workshop"
          ? searchResults.map((m) => m.workshop_id)
          : [];
    const missing = ids.filter((id) => !(id in usage));
    if (missing.length === 0) return;
    let cancelled = false;
    getModUsage(missing).then((rows) => {
      if (cancelled) return;
      setUsage((prev) => {
        const next = { ...prev };
        for (const r of rows) next[r.workshop_id] = r.total_servers;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subscribedForDayz, searchResults]);

  const preview = activeList.find((e) => e.id === previewId) ?? null;

  function toggle(entry: Entry) {
    setPending((p) => (p.includes(entry.id) ? p.filter((x) => x !== entry.id) : [...p, entry.id]));
    setMeta((m) => ({ ...m, [entry.id]: { title: entry.title, previewUrl: entry.previewUrl } }));
  }

  function apply() {
    setFilter({ mod_ids: pending, mod_match: mode });
    onClose();
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "subscribed", label: "Subscribed" },
    { key: "seen", label: "Seen on servers" },
    { key: "workshop", label: "Search Workshop" },
  ];

  return (
    <div
      className="ovl absolute inset-0 z-[60] flex items-center justify-center bg-[rgba(5,8,13,0.7)]"
      onMouseDown={closeIfOutside}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filter by mod"
        onKeyDown={trapTab}
        className="mod-filter-modal flex h-[540px] w-[min(700px,calc(100%-40px))] flex-col overflow-hidden rounded-[12px] border border-line bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[13px] font-extrabold tracking-tight text-ink">Filter by mod</h3>
            <p className="mt-0.5 text-[10px] text-muted">Only show servers running the mods you pick</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted transition-colors hover:text-ink">
            <X className="size-[15px]" />
          </button>
        </div>

        <div className="flex shrink-0 gap-0.5 px-4 pt-2.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              role="tab"
              aria-selected={tab === t.key}
              className={cn(
                "rounded-t-[6px] px-2.5 py-1.5 text-[10px] font-bold text-muted transition-colors",
                tab === t.key && "bg-accent-soft text-accent",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mx-4 mt-2.5 flex shrink-0 items-center gap-1.5 rounded-[7px] border border-line bg-surface2 px-2.5 py-[7px]">
          <Search className="size-[13px] shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "workshop"
                ? "Search the Workshop by name…"
                : tab === "subscribed"
                  ? "Filter your subscribed mods…"
                  : "Filter mods seen on these servers…"
            }
            aria-label="Search mods"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-muted"
          />
        </div>

        <div className="mt-2.5 flex min-h-0 flex-1">
          <div className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-line px-2.5 pb-2.5">
            {tab === "subscribed" && modsLoading && subscribedForDayz.length === 0 && <ListSpinner />}
            {tab === "seen" && knownLoading && <ListSpinner />}
            {tab === "workshop" && searchLoading && <ListSpinner />}
            {tab === "workshop" && !query.trim() && !searchLoading && (
              <p className="px-1.5 py-6 text-center text-[10.5px] leading-relaxed text-muted">
                Type a mod name above to search the Workshop.
              </p>
            )}
            {tab === "workshop" && searchError && (
              <p className="px-1.5 py-6 text-center text-[10.5px] leading-relaxed text-danger">{searchError}</p>
            )}
            {!searchLoading &&
              !(tab === "subscribed" && modsLoading && subscribedForDayz.length === 0) &&
              !(tab === "seen" && knownLoading) &&
              activeList.length === 0 &&
              !(tab === "workshop" && !query.trim()) &&
              !(tab === "workshop" && searchError) && (
                <p className="px-1.5 py-6 text-center text-[10.5px] text-muted">
                  {tab === "subscribed" ? "No subscribed DayZ mods." : "No mods match."}
                </p>
              )}
            {activeList.map((entry) => (
              // A `<div>`, not a `<button>` — the checkbox below is a real button of
              // its own, and a button can't nest inside a button.
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => setPreviewId(entry.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreviewId(entry.id);
                  }
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 text-left transition-colors hover:bg-surface2",
                  previewId === entry.id && "bg-accent-soft",
                )}
              >
                <span className="size-9 shrink-0 overflow-hidden rounded-[8px]">
                  <ModThumb id={entry.id} title={entry.title} previewUrl={entry.previewUrl} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[11px] font-bold text-ink">
                    <span className="truncate">{entry.title}</span>
                    {entry.subscribed && <Star className="size-[10px] shrink-0 fill-warn text-warn" />}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono-data text-[9px]",
                    entry.serverCount ? "text-accent2" : "text-muted",
                  )}
                >
                  {entry.serverCount ? `${entry.serverCount} srv` : "—"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(entry);
                  }}
                  aria-pressed={pending.includes(entry.id)}
                  aria-label={pending.includes(entry.id) ? `Remove ${entry.title} from filter` : `Add ${entry.title} to filter`}
                  className={cn(
                    "flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-muted text-transparent",
                    pending.includes(entry.id) && "border-accent bg-accent text-bg",
                  )}
                >
                  <Check className="size-[10px]" strokeWidth={2.6} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex min-w-0 max-w-[300px] flex-1 flex-col overflow-y-auto px-4 pb-3 pt-1">
            {!preview && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted">
                <Inbox className="size-6 opacity-50" />
                <p className="max-w-[20ch] text-[10.5px] leading-relaxed">
                  Click a mod on the left to see its details here.
                </p>
              </div>
            )}
            {preview && (
              <>
                <span className="mb-2.5 block h-[84px] w-full shrink-0 overflow-hidden rounded-[9px]">
                  <ModThumb id={preview.id} title={preview.title} previewUrl={preview.previewUrl} />
                </span>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 text-[13.5px] font-extrabold leading-tight tracking-tight text-ink">
                    {preview.title}
                    {preview.subscribed && <Star className="size-3 shrink-0 fill-warn text-warn" />}
                  </h4>
                  {preview.workshopUrl && (
                    <a
                      href={preview.workshopUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 pt-0.5 text-[9.5px] font-bold text-muted transition-colors hover:text-accent"
                    >
                      <ExternalLink className="size-[10px]" />
                      View on Steam
                    </a>
                  )}
                </div>
                {(preview.score !== null || preview.numSubscriptions || preview.fileSize) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted2">
                    {preview.score !== null && (
                      <span className="flex items-center gap-1">
                        <ThumbsUp className="size-[10px] text-muted" />
                        {Math.round(preview.score * 100)}%
                      </span>
                    )}
                    {preview.numSubscriptions && (
                      <>
                        <span className="text-muted">·</span>
                        <span className="flex items-center gap-1">
                          <Users className="size-[10px] text-muted" />
                          {Number(preview.numSubscriptions).toLocaleString()} subscribers
                        </span>
                      </>
                    )}
                    {preview.fileSize !== null && (
                      <>
                        <span className="text-muted">·</span>
                        <span>{formatBytes(preview.fileSize)}</span>
                      </>
                    )}
                    {preview.timeUpdated !== null && (
                      <>
                        <span className="text-muted">·</span>
                        <span>Updated {formatLastPlayed(preview.timeUpdated)}</span>
                      </>
                    )}
                  </div>
                )}
                {preview.description && (
                  <p className="mt-2.5 line-clamp-2 text-[11px] leading-relaxed text-muted2">{preview.description}</p>
                )}
                {preview.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {preview.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-[3px] border border-line bg-surface2 px-1.5 py-0.5 text-[8.5px] font-bold text-muted2"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2.5 rounded-[8px] border border-line bg-surface2 px-2.5 py-2 text-[10.5px] leading-relaxed text-muted2">
                  {preview.serverCount ? (
                    <>
                      <span className="font-mono-data font-bold text-accent2">{preview.serverCount}</span> of the
                      servers currently listed run this mod
                    </>
                  ) : (
                    "Not seen on any currently listed server yet — you can still filter for it"
                  )}
                </div>
                <button
                  onClick={() => toggle(preview)}
                  className={cn(
                    "mt-auto flex w-full items-center justify-center gap-1.5 rounded-[6px] border px-3 py-2 pt-4 text-[10.5px] font-bold",
                    pending.includes(preview.id)
                      ? "border-line text-muted hover:text-ink"
                      : "border-accent-line bg-accent-soft text-accent shadow-[var(--glow)] hover:brightness-110",
                  )}
                >
                  {pending.includes(preview.id) ? (
                    <>
                      <X className="size-[13px]" />
                      Remove from filter
                    </>
                  ) : (
                    <>
                      <Check className="size-[13px]" />
                      Add to filter
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 border-t border-line px-4 py-2.5">
          <div className="mr-auto flex items-center">
            {pending.length === 0 ? (
              <span className="text-[10px] text-muted">Nothing selected</span>
            ) : (
              <>
                <div className="flex">
                  {pending.slice(0, 4).map((id, i) => (
                    <span
                      key={id}
                      className="-ml-1.5 size-[18px] overflow-hidden rounded-[5px] border-[1.5px] border-surface first:ml-0"
                      style={{ zIndex: 4 - i }}
                    >
                      <ModThumb id={id} title={meta[id]?.title ?? id} previewUrl={meta[id]?.previewUrl ?? null} />
                    </span>
                  ))}
                  {pending.length > 4 && (
                    <span className="-ml-1.5 flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px] border-surface bg-surface2 text-[8px] font-bold text-muted2">
                      +{pending.length - 4}
                    </span>
                  )}
                </div>
                <span className="ml-2 text-[10px] text-muted">{pending.length} selected</span>
                <button
                  onClick={() => setPending([])}
                  className="ml-2.5 text-[9px] font-bold uppercase tracking-[0.05em] text-muted transition-colors hover:text-ink"
                >
                  Clear
                </button>
              </>
            )}
          </div>
          <div className="flex overflow-hidden rounded-[6px] border border-line">
            <button
              onClick={() => setMode("any")}
              className={cn(
                "px-2.5 py-[5px] text-[9.5px] font-bold text-muted",
                mode === "any" && "bg-accent-soft text-accent",
              )}
            >
              Match any
            </button>
            <button
              onClick={() => setMode("all")}
              className={cn(
                "px-2.5 py-[5px] text-[9.5px] font-bold text-muted",
                mode === "all" && "bg-accent-soft text-accent",
              )}
            >
              Match all
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-[6px] border border-line px-3.5 py-[7px] text-[10.5px] font-bold text-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            className="rounded-[6px] border border-accent-line bg-accent-soft px-3.5 py-[7px] text-[10.5px] font-bold text-accent shadow-[var(--glow)] transition-[filter] hover:brightness-110"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function ListSpinner() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-[10.5px] text-muted">
      <Loader2 className="size-3.5 animate-spin" />
      Loading…
    </div>
  );
}
