import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search, Check, Ban, Star, ExternalLink, ThumbsUp, Users, Loader2, Inbox } from "lucide-react";
import { useModsStore } from "@/stores/mods-store";
import {
  useModFilterStore,
  activeEntries,
  pickSummary,
  type ModFilterEntry,
} from "@/stores/mod-filter-store";
import { useModFilterLifecycle } from "@/hooks/use-mod-filter-lifecycle";
import { cn, formatBytes, formatLastPlayed } from "@/lib/utils";
import { hashHue, initials } from "@/theme/elements/mod-thumbnail";

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

const TABS: { key: "subscribed" | "seen" | "workshop"; label: string }[] = [
  { key: "subscribed", label: "Subscribed" },
  { key: "seen", label: "Seen on servers" },
  { key: "workshop", label: "Search Workshop" },
];

// "Filter by mod" modal, opened from the filter bar's MODS trigger. Three
// pools — Subscribed / Seen on servers / Search Workshop — feeding one
// split list+preview layout. Focus trapped; Escape, ✕ and backdrop close
// without applying, same contract as ServerInfoModal.
export function ModFilterModal({ onClose }: ModFilterModalProps) {
  const modsLoading = useModsStore((s) => s.loading);

  const tab = useModFilterStore((s) => s.tab);
  const query = useModFilterStore((s) => s.query);
  const selection = useModFilterStore((s) => s.selection);
  const mode = useModFilterStore((s) => s.mode);
  const previewId = useModFilterStore((s) => s.previewId);
  const meta = useModFilterStore((s) => s.meta);
  const known = useModFilterStore((s) => s.known);
  const knownLoading = useModFilterStore((s) => s.knownLoading);
  const searchResults = useModFilterStore((s) => s.searchResults);
  const searchLoading = useModFilterStore((s) => s.searchLoading);
  const searchError = useModFilterStore((s) => s.searchError);
  const usage = useModFilterStore((s) => s.usage);

  const begin = useModFilterStore((s) => s.begin);
  const applyFilter = useModFilterStore((s) => s.apply);
  const setTab = useModFilterStore((s) => s.setTab);
  const setQuery = useModFilterStore((s) => s.setQuery);
  const setMode = useModFilterStore((s) => s.setMode);
  const setPreviewId = useModFilterStore((s) => s.setPreviewId);
  const cycle = useModFilterStore((s) => s.cycle);
  const setPick = useModFilterStore((s) => s.setPick);
  const clearSelection = useModFilterStore((s) => s.clearSelection);

  const { subscribedRows } = useModFilterLifecycle();

  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const activeList: ModFilterEntry[] = useMemo(
    () => activeEntries({ tab, query, subscribedRows, known, searchResults, usage }),
    [tab, query, subscribedRows, known, searchResults, usage],
  );

  const preview = activeList.find((e) => e.id === previewId) ?? null;

  const { included, excluded } = useMemo(() => pickSummary(selection), [selection]);

  function apply() {
    applyFilter();
    onClose();
  }

  return (
    <div
      className="ovl absolute inset-0 z-[60] flex items-center justify-center [background-color:var(--t-color-scrim)]"
      onMouseDown={closeIfOutside}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filter by mod"
        onKeyDown={trapTab}
        className="mod-filter-modal relative flex h-[540px] w-[min(700px,calc(100%-40px))] flex-col overflow-hidden [border-radius:var(--t-radius-modalLarge)] border border-line bg-surface [box-shadow:var(--t-shadow-xl)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="[font-size:var(--t-type-size-xl)] font-extrabold tracking-tight text-ink">Filter by mod</h3>
            <p className="mt-0.5 [font-size:var(--t-type-label-size)] text-muted">Require or exclude servers by the mods they run</p>
          </div>
          {closeAction()}
        </div>

        {tabStrip()}

        <div className="mx-4 mt-2.5 flex shrink-0 items-center gap-1.5 [border-radius:var(--t-radius-popup)] border border-line bg-surface2 px-2.5 py-[7px]">
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
            className="min-w-0 flex-1 bg-transparent [font-size:var(--t-type-body-size)] text-ink outline-none placeholder:text-muted"
          />
        </div>

        <div className="mt-2.5 flex min-h-0 flex-1">
          <div className="flex min-w-0 w-[380px] shrink-0 flex-col overflow-y-auto border-r border-line px-2.5 pb-2.5">
            {tab === "subscribed" && modsLoading && subscribedRows.length === 0 && <ListSpinner />}
            {tab === "seen" && knownLoading && <ListSpinner />}
            {tab === "workshop" && searchLoading && <ListSpinner />}
            {tab === "workshop" && !query.trim() && !searchLoading && (
              <p className="px-1.5 py-6 text-center [font-size:var(--t-type-compactBody-size)] leading-relaxed text-muted">
                Type a mod name above to search the Workshop.
              </p>
            )}
            {tab === "workshop" && searchError && (
              <p className="px-1.5 py-6 text-center [font-size:var(--t-type-compactBody-size)] leading-relaxed text-danger">{searchError}</p>
            )}
            {!searchLoading &&
              !(tab === "subscribed" && modsLoading && subscribedRows.length === 0) &&
              !(tab === "seen" && knownLoading) &&
              activeList.length === 0 &&
              !(tab === "workshop" && !query.trim()) &&
              !(tab === "workshop" && searchError) && (
                <p className="px-1.5 py-6 text-center [font-size:var(--t-type-compactBody-size)] text-muted">
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
                  "flex w-full cursor-pointer items-center gap-2.5 [border-radius:var(--t-radius-popup)] px-1.5 py-1.5 text-left transition-colors hover:bg-surface2",
                  previewId === entry.id && "bg-accent-soft",
                )}
              >
                <span className="size-9 shrink-0 overflow-hidden [border-radius:var(--t-radius-row)]">
                  <ModThumb id={entry.id} title={entry.title} previewUrl={entry.previewUrl} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate [font-size:var(--t-type-body-size)] font-bold text-ink">
                    <span className="truncate">{entry.title}</span>
                    {entry.subscribed && <Star className="size-[10px] shrink-0 fill-warn text-warn" />}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono-data [font-size:var(--t-type-caption-size)]",
                    entry.serverCount ? "text-accent2" : "text-muted",
                  )}
                >
                  {entry.serverCount ? `${entry.serverCount} srv` : "—"}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cycle(entry);
                  }}
                  aria-label={
                    selection[entry.id] === "include"
                      ? `Exclude ${entry.title} instead`
                      : selection[entry.id] === "exclude"
                        ? `Clear the ${entry.title} filter`
                        : `Include ${entry.title}`
                  }
                  className={cn(
                    "flex size-[15px] shrink-0 items-center justify-center [border-radius:var(--t-radius-chip)] border-[1.5px] border-muted text-transparent",
                    selection[entry.id] === "include" && "border-accent bg-accent text-bg",
                    selection[entry.id] === "exclude" && "border-danger bg-danger text-bg",
                  )}
                >
                  {selection[entry.id] === "exclude" ? (
                    <Ban className="size-[10px]" strokeWidth={2.6} />
                  ) : (
                    <Check className="size-[10px]" strokeWidth={2.6} />
                  )}
                </button>
              </div>
            ))}
          </div>

          {previewPane()}
        </div>

        <div className="flex shrink-0 items-center gap-2.5 border-t border-line px-4 py-2.5">
          <div className="mr-auto flex items-center">
            {included.length === 0 && excluded.length === 0 ? (
              <span className="[font-size:var(--t-type-label-size)] text-muted">Nothing selected</span>
            ) : (
              <>
                <div className="flex">
                  {[
                    ...included.map((id) => ({ id, pick: "include" as const })),
                    ...excluded.map((id) => ({ id, pick: "exclude" as const })),
                  ]
                    .slice(0, 4)
                    .map(({ id, pick }, i) => (
                      <span
                        key={id}
                        className={cn(
                          "-ml-1.5 size-[18px] overflow-hidden [border-radius:var(--t-radius-controlCompact)] border-[1.5px] first:ml-0",
                          pick === "include" ? "border-accent" : "border-danger",
                        )}
                        style={{ zIndex: 4 - i }}
                      >
                        <ModThumb id={id} title={meta[id]?.title ?? id} previewUrl={meta[id]?.previewUrl ?? null} />
                      </span>
                    ))}
                  {included.length + excluded.length > 4 && (
                    <span className="-ml-1.5 flex size-[18px] items-center justify-center [border-radius:var(--t-radius-controlCompact)] border-[1.5px] border-surface bg-surface2 [font-size:var(--t-type-micro-size)] font-bold text-muted2">
                      +{included.length + excluded.length - 4}
                    </span>
                  )}
                </div>
                <span className="ml-2 [font-size:var(--t-type-label-size)] text-muted">
                  {included.length > 0 && `${included.length} included`}
                  {included.length > 0 && excluded.length > 0 && " · "}
                  {excluded.length > 0 && `${excluded.length} excluded`}
                </span>
                <button
                  onClick={() => clearSelection()}
                  className="ml-2.5 [font-size:var(--t-type-caption-size)] font-bold uppercase tracking-[0.05em] text-muted transition-colors hover:text-ink"
                >
                  Clear
                </button>
              </>
            )}
          </div>
          <div className="flex overflow-hidden [border-radius:var(--t-radius-control)] border border-line">
            <button
              onClick={() => setMode("any")}
              className={cn(
                "px-2.5 py-[5px] [font-size:var(--t-type-compactCaption-size)] font-bold text-muted",
                mode === "any" && "bg-accent-soft text-accent",
              )}
            >
              Match any
            </button>
            <button
              onClick={() => setMode("all")}
              className={cn(
                "px-2.5 py-[5px] [font-size:var(--t-type-compactCaption-size)] font-bold text-muted",
                mode === "all" && "bg-accent-soft text-accent",
              )}
            >
              Match all
            </button>
          </div>
          <button
            onClick={onClose}
            className="[border-radius:var(--t-radius-control)] border border-line px-3.5 py-[7px] [font-size:var(--t-type-compactBody-size)] font-bold text-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
          {applyAction()}
        </div>
      </div>
    </div>
  );

  function closeAction(): React.ReactNode {
    return (
      <button
        data-tetra-el="closeAction"
        onClick={onClose}
        aria-label="Close"
        className="text-muted transition-colors hover:text-ink"
      >
        <X className="size-[15px]" />
      </button>
    );
  }

  function tabStrip(): React.ReactNode {
    return (
      <div data-tetra-el="tabStrip" className="flex shrink-0 gap-0.5 px-4 pt-2.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            role="tab"
            aria-selected={tab === t.key}
            className={cn(
              "rounded-t-[6px] px-2.5 py-1.5 [font-size:var(--t-type-label-size)] font-bold text-muted transition-colors",
              tab === t.key && "bg-accent-soft text-accent",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    );
  }

  function previewPane(): React.ReactNode {
    return (
      <div
        data-tetra-el="previewPane"
        className="flex min-w-0 max-w-[300px] flex-1 flex-col overflow-y-auto px-4 pb-3 pt-1"
      >
        {!preview && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted">
            <Inbox className="size-6 opacity-50" />
            <p className="max-w-[20ch] [font-size:var(--t-type-compactBody-size)] leading-relaxed">
              Click a mod on the left to see its details here.
            </p>
          </div>
        )}
        {preview && (
          <>
            <span className="mb-2.5 block h-[84px] w-full shrink-0 overflow-hidden [border-radius:var(--t-radius-panel)]">
              <ModThumb id={preview.id} title={preview.title} previewUrl={preview.previewUrl} />
            </span>
            <div className="flex items-start justify-between gap-2">
              <h4 className="flex items-center gap-1.5 [font-size:var(--t-type-compactHeading-size)] font-extrabold leading-tight tracking-tight text-ink">
                {preview.title}
                {preview.subscribed && <Star className="size-3 shrink-0 fill-warn text-warn" />}
              </h4>
              {preview.workshopUrl && (
                <a
                  href={preview.workshopUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 pt-0.5 [font-size:var(--t-type-compactCaption-size)] font-bold text-muted transition-colors hover:text-accent"
                >
                  <ExternalLink className="size-[10px]" />
                  View on Steam
                </a>
              )}
            </div>
            {(preview.score !== null || preview.numSubscriptions || preview.fileSize) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 [font-size:var(--t-type-label-size)] text-muted2">
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
              <p className="mt-2.5 line-clamp-2 [font-size:var(--t-type-body-size)] leading-relaxed text-muted2">{preview.description}</p>
            )}
            {preview.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {preview.tags.map((t) => (
                  <span
                    key={t}
                    className="[border-radius:var(--t-radius-badge)] border border-line bg-surface2 px-1.5 py-0.5 [font-size:var(--t-type-compactMicro-size)] font-bold text-muted2"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5 [border-radius:var(--t-radius-row)] border border-line bg-surface2 px-2.5 py-2 [font-size:var(--t-type-compactBody-size)] leading-relaxed text-muted2">
              {preview.serverCount ? (
                <>
                  <span className="font-mono-data font-bold text-accent2">{preview.serverCount}</span> of the
                  servers currently listed run this mod
                </>
              ) : (
                "Not seen on any currently listed server yet — you can still filter for it"
              )}
            </div>
            <div className="mt-auto flex gap-2 pt-4">
              <button
                onClick={() => setPick(preview, "include")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 [border-radius:var(--t-radius-control)] border px-3 py-2 [font-size:var(--t-type-compactBody-size)] font-bold",
                  selection[preview.id] === "include"
                    ? "border-accent-line bg-accent-soft text-accent [box-shadow:var(--t-shadow-glow)]"
                    : "border-line text-muted hover:text-ink",
                )}
              >
                <Check className="size-[13px]" />
                {selection[preview.id] === "include" ? "Included" : "Include"}
              </button>
              <button
                onClick={() => setPick(preview, "exclude")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 [border-radius:var(--t-radius-control)] border px-3 py-2 [font-size:var(--t-type-compactBody-size)] font-bold",
                  selection[preview.id] === "exclude"
                    ? "border-danger-line bg-danger-soft text-danger"
                    : "border-line text-muted hover:text-ink",
                )}
              >
                <Ban className="size-[13px]" />
                {selection[preview.id] === "exclude" ? "Excluded" : "Exclude"}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  function applyAction(): React.ReactNode {
    return (
      <button
        data-tetra-el="applyAction"
        onClick={apply}
        className="[border-radius:var(--t-radius-control)] border border-accent-line bg-accent-soft px-3.5 py-[7px] [font-size:var(--t-type-compactBody-size)] font-bold text-accent [box-shadow:var(--t-shadow-glow)] transition-[filter] hover:brightness-110"
      >
        Apply
      </button>
    );
  }
}

function ListSpinner() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 [font-size:var(--t-type-compactBody-size)] text-muted">
      <Loader2 className="size-3.5 animate-spin" />
      Loading…
    </div>
  );
}
