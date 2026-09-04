import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Globe,
  X,
  Check,
} from "lucide-react";
import {
  useModsStore,
  visibleRows,
  type ModStatusFilter,
} from "@/stores/mods-store";
import {
  steamModStates,
  steamDownloadProgress,
  reinstallSubscribedMod,
  openModFolder,
  openWorkshopInSteam,
  type ModState,
  type SubscribedMod,
} from "@/lib/tauri";
import { cn, formatBytes, formatLastPlayed } from "@/lib/utils";

// Mods tab: rich rows with a slide-in inspector, status filter, and action bar.

const STATUS_UI: Record<
  ModState,
  { tone: "ready" | "update" | "dl" | "muted"; label: string }
> = {
  ready: { tone: "ready", label: "Ready" },
  needs_update: { tone: "update", label: "Update" },
  downloading: { tone: "dl", label: "Downloading" },
  not_installed: { tone: "muted", label: "Missing" },
  not_subscribed: { tone: "muted", label: "Not subscribed" },
  not_on_workshop: { tone: "muted", label: "Server-side" },
};

const STATUS_FILTERS: { key: ModStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "outdated", label: "Outdated" },
  { key: "downloading", label: "Downloading" },
];

function modSubscribed(mod: { time_added_to_user_list: number; install_timestamp: number }) {
  return mod.time_added_to_user_list || mod.install_timestamp || 0;
}

/**
 * Resolve effective mod state between the authoritative Workshop enumeration row
 * and the 1.5s live Steam client poll. Steam's local item_state reports "ready" for
 * any installed mod because it doesn't query the Workshop; a cheap poll must never
 * downgrade an authoritative "needs_update" from Workshop enumeration to "ready".
 */
export function effectiveModState(rowState: ModState, liveState?: ModState): ModState {
  if (!liveState) return rowState;
  if (liveState === "downloading") return "downloading";
  if (rowState === "needs_update") {
    if (liveState === "ready") return "needs_update";
  }
  return liveState;
}

// Shallow-compared slice so a change to something only a child cares about
// (progress, selectedIds) doesn't re-run this component and every row.
function useModsTabSlice() {
  return useModsStore(
    useShallow((s) => ({
      rows: s.rows,
      search: s.search,
      statusFilter: s.statusFilter,
      sortKey: s.sortKey,
      sortDir: s.sortDir,
      states: s.states,
      loading: s.loading,
      error: s.error,
      fromCache: s.fromCache,
      selectedModId: s.selectedModId,
      op: s.op,
      load: s.load,
      loadCaredServers: s.loadCaredServers,
      setLive: s.setLive,
      setProgress: s.setProgress,
      setSearch: s.setSearch,
      setStatusFilter: s.setStatusFilter,
    })),
  );
}

export function ModsTab() {
  const {
    rows,
    search,
    statusFilter,
    sortKey,
    sortDir,
    states,
    loading,
    error,
    fromCache,
    selectedModId,
    op,
    load,
    loadCaredServers,
    setLive,
    setProgress,
    setSearch,
    setStatusFilter,
  } = useModsTabSlice();

  const mods = useMemo(() => {
    let visible = visibleRows(rows);
    const q = search.trim().toLowerCase();
    if (q) {
      visible = visible.filter(
        (r) =>
          (r.title ?? "").toLowerCase().includes(q) ||
          (r.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
          (r.workshop_id ?? "").includes(q),
      );
    }
    if (statusFilter !== "all") {
      visible = visible.filter((r) => {
        const state = effectiveModState(r.state, states[r.workshop_id]);
        switch (statusFilter) {
          case "outdated":
            return state === "needs_update";
          case "downloading":
            return state === "downloading";
        }
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return (a.title ?? "").localeCompare(b.title ?? "") * dir;
        case "subscribed":
          return (modSubscribed(a) - modSubscribed(b)) * dir;
        case "updated":
          return ((a.time_updated ?? 0) - (b.time_updated ?? 0)) * dir;
        case "size":
          return (Number(a.size_on_disk || 0) - Number(b.size_on_disk || 0)) * dir;
      }
    });
  }, [rows, states, search, statusFilter, sortKey, sortDir]);

  const removedCount = rows.filter((r) => r.removed).length;

  // Load the tab on first mount, then poll live state + progress.
  useEffect(() => {
    void load();
    void loadCaredServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ids = visibleRows(rows).map((r) => r.workshop_id);
    if (ids.length === 0) return;
    let cancelled = false;
    let prevStates: Record<string, ModState> = {};
    async function poll() {
      try {
        const [entries, progress] = await Promise.all([
          steamModStates(ids),
          steamDownloadProgress(ids),
        ]);
        if (cancelled) return;
        const nextStates = Object.fromEntries(entries.map((e) => [e.workshop_id, e.state]));
        const finishedDownload = entries.some(
          (e) => e.state === "ready" && prevStates[e.workshop_id] === "downloading",
        );
        prevStates = nextStates;
        setLive(nextStates);
        setProgress(
          Object.fromEntries(
            progress.map((p) => [
              p.workshop_id,
              { downloaded: p.downloaded, total: p.total },
            ]),
          ),
        );
        if (finishedDownload) {
          void load(true);
        }
      } catch {
        /* next tick */
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rows, setLive, setProgress, load]);

  const selectedMod = rows.find((r) => r.workshop_id === selectedModId) ?? null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: mods.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 54, // measured row height
    gap: 6,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Filter / toolbar strip ── */}
      <div className="filterbar flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2.5 py-2">
        <div className="search flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] border border-line bg-surface2 px-2.5 py-[5px]">
          <Search className="size-3 shrink-0 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mods by name, tag or id…"
            aria-label="Search mods"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-[11px] text-ink outline-none placeholder:text-muted"
          />
        </div>

        <div className="flex items-center gap-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                "fbtn flex items-center justify-center rounded-[6px] border border-line bg-surface2 px-2.5 py-[5px] text-[10px] font-bold uppercase tracking-wider transition-colors",
                statusFilter === f.key
                  ? "border-accent-line bg-accent-soft text-accent shadow-[var(--glow)]"
                  : "text-muted hover:text-ink",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => void load(true)}
          disabled={loading || !!op}
          title="Re-read the list and refresh details from the Workshop"
          className="fbtn flex shrink-0 items-center gap-1 rounded-[6px] border border-line bg-surface2 px-2 py-[5px] text-[10px] font-bold uppercase tracking-wider text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="border-b border-danger-line bg-danger-soft px-3 py-1.5 text-[11px] text-danger">
          {error}
        </div>
      )}
      {fromCache && (
        <div className="border-b border-warn bg-warn-soft px-3 py-1.5 text-[10px] uppercase tracking-wider text-warn">
          Steam unreachable — showing last known mod list
        </div>
      )}

      {/* ── Body: list + slide-in inspector ── */}
      <div className="mods-content relative min-h-0 flex-1 overflow-hidden">
        <div className="mx-wrap relative h-full overflow-hidden">
          <div ref={scrollRef} className="mx-list h-full overflow-y-auto p-2">
            {loading && mods.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted">
                <Loader2 className="size-3.5 animate-spin" /> Loading subscribed mods…
              </div>
            ) : mods.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted">
                {search || statusFilter !== "all"
                  ? "No mods match the current filter."
                  : "You have no subscribed DayZ Workshop mods."}
              </div>
            ) : (
              <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
                {virtualItems.map((virtualRow) => {
                  const mod = mods[virtualRow.index];
                  return (
                    <div
                      key={mod.workshop_id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <ModRow mod={mod} selected={selectedModId === mod.workshop_id} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedMod && <ModInspector mod={selectedMod} />}
        </div>
      </div>

      {/* ── Bottom action bar ── */}
      <ModsActionBar removedCount={removedCount} />
    </div>
  );
}

// Selects only this row's own slice of the store, so it re-renders only
// when its own selected flag, state or progress entry actually changes.
const ModRow = memo(function ModRow({
  mod,
  selected,
}: {
  mod: SubscribedMod;
  selected: boolean;
}) {
  const checked = useModsStore((s) => s.selectedIds.has(mod.workshop_id));
  const rawLive = useModsStore((s) => s.states[mod.workshop_id]);
  const state = effectiveModState(mod.state, rawLive);
  const progress = useModsStore((s) => s.progress[mod.workshop_id]);
  const toggleSelected = useModsStore((s) => s.toggleSelected);
  const openMod = useModsStore((s) => s.openMod);
  const ui = STATUS_UI[state];

  return (
    <div
      onClick={() => openMod(selected ? null : mod.workshop_id)}
      className={cn(
        "mx-row flex cursor-pointer items-center gap-2.5 rounded-[8px] border border-line bg-surface px-2.5 py-2 transition-[border-color,background,box-shadow] duration-150 hover:border-accent-line",
        selected && "border-accent-line bg-accent-soft shadow-[var(--glow)]",
        mod.locally_disabled && "opacity-50",
      )}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          toggleSelected(mod.workshop_id);
        }}
        className="mx-check flex items-center justify-center"
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            toggleSelected(mod.workshop_id);
          }
        }}
      >
        <span
          className={cn(
            "box flex h-[13px] w-[13px] items-center justify-center rounded-[3px] border border-line transition-colors",
            checked
              ? "border-accent bg-accent text-[#10131a] shadow-[var(--glow)]"
              : "bg-surface2 hover:border-accent-line",
          )}
        >
          {checked && <Check className="size-2.5 stroke-[3]" />}
        </span>
      </div>

      <div className="mx-thumb h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[7px] bg-surface2">
        {mod.preview_url ? (
          <img
            src={mod.preview_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[9px] text-muted">
            {mod.locally_disabled ? "⏸" : "—"}
          </div>
        )}
      </div>

      <div className="mx-main min-w-0 flex-1">
        <div className="mx-title flex min-w-0 items-center gap-1.5 text-[11px] font-semibold">
          <span className="truncate text-ink">{mod.title ?? mod.workshop_id}</span>
          {mod.locally_disabled && (
            <span className="shrink-0 rounded-[4px] border border-muted/50 px-1 text-[8px] font-bold uppercase tracking-wider text-muted2">
              Disabled
            </span>
          )}
        </div>
        <div className="mx-meta truncate text-[8px] text-muted">
          {(mod.tags ?? []).slice(0, 3).join(" · ") || mod.workshop_id}
        </div>
      </div>

      <div className="mx-state flex w-[104px] shrink-0 flex-col justify-center gap-[3px]">
        <span className={cn("st inline-flex items-center gap-1.5", ui.tone)}>
          <span className="d h-[7px] w-[7px] shrink-0 rounded-full" />
          <span className="l text-[8px] whitespace-nowrap">{ui.label}</span>
        </span>
        {state === "downloading" && progress && progress.total && Number(progress.total) > 0 && (
          <div className="mx-prog h-[3px] overflow-hidden rounded-full bg-line">
            <i
              className="block h-full rounded-full bg-accent shadow-[var(--glow)]"
              style={{
                width: `${Math.min(100, (Number(progress.downloaded) / Number(progress.total)) * 100)}%`,
              }}
            />
          </div>
        )}
      </div>

      <span className="mx-num sz shrink-0 text-right font-mono-data text-[9px] text-accent2">
        {mod.size_on_disk ? formatBytes(Number(mod.size_on_disk), 1) : "—"}
      </span>
      <span className="mx-num upd shrink-0 text-right font-mono-data text-[9px] text-muted2">
        {mod.time_updated ? formatLastPlayed(mod.time_updated) : "—"}
      </span>
    </div>
  );
});

function ModInspector({ mod }: { mod: SubscribedMod }) {
  const rawLive = useModsStore((s) => s.states[mod.workshop_id]);
  const state = effectiveModState(mod.state, rawLive);
  const openMod = useModsStore((s) => s.openMod);
  const load = useModsStore((s) => s.load);
  const op = useModsStore((s) => s.op);
  const updateMods = useModsStore((s) => s.updateMods);
  const [reinstalling, setReinstalling] = useState(false);
  const updating = op?.kind === "update";
  const ui = STATUS_UI[state];

  function openInSteam() {
    void openWorkshopInSteam(mod.workshop_id).catch((e) => console.error(e));
  }

  async function reinstall() {
    setReinstalling(true);
    try {
      await reinstallSubscribedMod(mod.workshop_id);
    } catch (e) {
      console.error(e);
    }
    setReinstalling(false);
    void load(true);
  }

  return (
    <div className="mx-inspector absolute bottom-0 right-0 top-0 z-[8] flex w-[340px] flex-col overflow-hidden border-l border-line bg-surface shadow-[-10px_0_26px_rgba(0,0,0,0.4)]">
      <button
        onClick={() => openMod(null)}
        aria-label="Close details"
        className="mxi-close absolute right-2 top-2 z-[3] flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border border-line bg-[rgba(10,12,16,0.7)] text-muted2 transition-colors hover:border-accent-line hover:text-ink"
      >
        <X className="size-3" />
      </button>

      <div className="body flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        <div className="m2-preview relative h-[118px] shrink-0 overflow-hidden rounded-[7px] bg-surface2">
          {mod.preview_url ? (
            <img src={mod.preview_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-muted">
              No preview image
            </div>
          )}
          {mod.locally_disabled && (
            <span className="absolute left-2 top-2 rounded border border-muted/60 bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink">
              Disabled
            </span>
          )}
        </div>

        <h2 className="m2-title text-[13px] font-bold leading-snug text-ink">
          {mod.title ?? mod.workshop_id}
        </h2>
        <div className="flex items-center gap-1.5 text-[9px] text-muted">
          <span className={cn("inline-block h-[7px] w-[7px] rounded-full", STATUS_DOT[ui.tone])} />
          <span className={cn("truncate", STATUS_LABEL[ui.tone])}>{ui.label}</span>
        </div>

        <div className="m2-tags flex flex-wrap gap-1">
          {(mod.tags ?? []).slice(0, 6).map((t: string) => (
            <span
              key={t}
              className="tag rounded-[4px] bg-surface2 px-1.5 py-0.5 text-[8px] text-muted2"
            >
              {t}
            </span>
          ))}
        </div>

        {mod.description && (
          <p className="m2-desc line-clamp-6 text-[10px] leading-relaxed text-muted">
            {mod.description}
          </p>
        )}

        <div className="m2-rows2 mt-1 flex flex-col gap-1">
          <InspectorRow label="Subscribed" value={modSubscribed(mod) ? formatLastPlayed(modSubscribed(mod)) : "—"} />
          <InspectorRow label="Updated" value={mod.time_updated ? formatLastPlayed(mod.time_updated) : "—"} />
          <InspectorRow label="Size" value={mod.size_on_disk ? formatBytes(Number(mod.size_on_disk), 1) : "—"} />
          <InspectorRow
            label="Rating"
            value={mod.num_upvotes + mod.num_downvotes ? `${mod.num_upvotes}▲ / ${mod.num_downvotes}▼` : "—"}
          />
          <InspectorRow label="Workshop id" value={mod.workshop_id} />
        </div>

        <div className="m2-actions mt-0.5 flex gap-1.5">
          {state === "needs_update" && (
            <button
              onClick={() => void updateMods([mod.workshop_id])}
              disabled={updating}
              title="Download the newer Workshop copy"
              className="m2-btn flex flex-1 items-center justify-center gap-1 rounded-[6px] border border-warn-line bg-warn-soft px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.03em] text-warn transition-colors disabled:opacity-50"
            >
              <Download className={cn("size-3", updating && "animate-pulse")} />
              {updating ? "…" : "Update"}
            </button>
          )}
          <button
            onClick={openInSteam}
            className="m2-btn flex flex-1 items-center justify-center gap-1 rounded-[6px] border border-line bg-surface2 px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.03em] text-muted2 transition-colors hover:text-ink"
          >
            <ExternalLink className="size-3" /> Open in Steam
          </button>
          {mod.folder && (
            <button
              onClick={() => void openModFolder(mod.folder!)}
              className="m2-btn flex flex-1 items-center justify-center gap-1 rounded-[6px] border border-line bg-surface2 px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.03em] text-muted2 transition-colors hover:text-ink"
            >
              <FolderOpen className="size-3" /> Open folder
            </button>
          )}
          <button
            onClick={() => void reinstall()}
            disabled={reinstalling}
            className="m2-btn flex flex-1 items-center justify-center gap-1 rounded-[6px] border border-accent-line bg-accent-soft px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.03em] text-accent shadow-[var(--glow)] transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3", reinstalling && "animate-spin")} />
            {reinstalling ? "…" : "Reinstall"}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_DOT: Record<"ready" | "update" | "dl" | "muted", string> = {
  ready: "bg-success shadow-[0_0_5px_rgba(77,154,117,0.6)]",
  update: "bg-warn shadow-[0_0_5px_rgba(193,154,85,0.6)]",
  dl: "bg-accent shadow-[var(--glow)]",
  muted: "bg-muted",
};

const STATUS_LABEL: Record<"ready" | "update" | "dl" | "muted", string> = {
  ready: "text-success",
  update: "text-warn",
  dl: "text-accent",
  muted: "text-muted2",
};

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="m2-ir flex items-baseline justify-between gap-2">
      <span className="k shrink-0 text-[8px] font-bold uppercase tracking-[0.05em] text-muted">
        {label}
      </span>
      <span className="v min-w-0 truncate text-right font-mono-data text-[9px] text-ink">{value}</span>
    </div>
  );
}

/** The bottom action bar: Verify + Unsubscribe, each with a revealed dropdown,
    plus the unique-per-server selection and the removed-mod clean-up. */
function ModsActionBar({ removedCount }: { removedCount: number }) {
  // Narrow slice: this bar doesn't read states/progress/search, so it
  // shouldn't re-render on the poll tick or every keystroke.
  const store = useModsStore(
    useShallow((s) => ({
      selectedIds: s.selectedIds,
      rows: s.rows,
      op: s.op,
      verifyResult: s.verifyResult,
      mutationFailures: s.mutationFailures,
      uniqueResult: s.uniqueResult,
      clearVerifyResult: s.clearVerifyResult,
      clearMutationFailures: s.clearMutationFailures,
      clearUniqueResult: s.clearUniqueResult,
      clearSelection: s.clearSelection,
      setAllSelected: s.setAllSelected,
      cleanupRemoved: s.cleanupRemoved,
      unsubscribeSelected: s.unsubscribeSelected,
      unsubscribeAll: s.unsubscribeAll,
      verifyAll: s.verifyAll,
      verifySelected: s.verifySelected,
      updateAllOutdated: s.updateAllOutdated,
    })),
  );
  const [menu, setMenu] = useState<"verify" | "unsub" | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const selectedCount = store.selectedIds.size;
  const allCount = visibleRows(store.rows).length;
  const outdatedCount = visibleRows(store.rows).filter((r) => r.state === "needs_update").length;

  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const busy = !!store.op;

  // In-app confirm, not window.confirm — WebKitGTK doesn't reliably show script dialogs.
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => void;
  } | null>(null);

  function askConfirm(title: string, message: string, action: () => void) {
    setMenu(null);
    setConfirm({ title, message, action });
  }

  return (
    <div ref={barRef} className="mods-actionbar relative shrink-0 border-t border-line bg-surface">
      {/* Last VERIFY / unsubscribe / unique-select outcome, if there is one. */}
      {(store.verifyResult || store.mutationFailures || store.uniqueResult) && (
        <div className="flex items-center gap-2 border-b border-line bg-surface2 px-3 py-1">
          {store.verifyResult && (
            <span className="text-[10px] text-muted2">
              <span className="font-semibold text-ink">{store.verifyResult.checked} checked</span>
              <span className="text-muted"> · </span>
              <span className="font-semibold text-warn">{store.verifyResult.outdated} outdated</span>
              <span className="text-muted"> · </span>
              <span className="font-semibold text-accent">{store.verifyResult.queued} re-downloading</span>
            </span>
          )}
          {store.mutationFailures && store.mutationFailures.length > 0 && (
            <span className="text-[10px] text-danger">
              {store.mutationFailures.length} mod
              {store.mutationFailures.length === 1 ? "" : "s"} could not be removed: {store.mutationFailures[0][1]}
            </span>
          )}
          {store.mutationFailures && store.mutationFailures.length === 0 && (
            <span className="text-[10px] text-success">Removed ok</span>
          )}
          {store.uniqueResult &&
            (store.uniqueResult.totalUnique === 0 ? (
              <span className="text-[10px] text-warn">
                No mods are unique to {store.uniqueResult.server} — every mod it uses is shared
                with another favourite/recent server.
              </span>
            ) : store.uniqueResult.selected === 0 ? (
              <span className="text-[10px] text-warn">
                {store.uniqueResult.totalUnique} mod
                {store.uniqueResult.totalUnique === 1 ? " is" : "s are"} unique to{" "}
                {store.uniqueResult.server}, but none are in your subscribed library — nothing
                was selected.
              </span>
            ) : store.uniqueResult.selected === store.uniqueResult.totalUnique ? (
              <span className="text-[10px] text-muted2">
                <span className="font-semibold text-ink">{store.uniqueResult.selected}</span>{" "}
                unique mod{store.uniqueResult.selected === 1 ? "" : "s"} for{" "}
                {store.uniqueResult.server} selected
              </span>
            ) : (
              <span className="text-[10px] text-muted2">
                <span className="font-semibold text-ink">{store.uniqueResult.selected}</span> of{" "}
                {store.uniqueResult.totalUnique} unique mods for {store.uniqueResult.server} selected
                ({store.uniqueResult.totalUnique - store.uniqueResult.selected} not in your library)
              </span>
            ))}
          <button
            onClick={() => {
              store.clearVerifyResult();
              store.clearMutationFailures();
              store.clearUniqueResult();
            }}
            className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-ink"
          >
            DISMISS
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 px-2.5 py-[7px]">
        <span className="ab-count shrink-0 text-[10px] tabular-nums text-muted">
          {selectedCount > 0 ? (
            <>
              <span className="font-semibold text-ink">{selectedCount}</span> of {allCount} selected
            </>
          ) : (
            `${allCount} mod${allCount === 1 ? "" : "s"}`
          )}
        </span>
        {selectedCount < allCount && (
          <button
            onClick={() => store.setAllSelected(true)}
            disabled={allCount === 0}
            className="ab-link shrink-0 text-[9px] font-bold uppercase tracking-[0.06em] text-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            Select all
          </button>
        )}
        {selectedCount > 0 && (
          <button
            onClick={() => store.clearSelection()}
            className="ab-link shrink-0 text-[9px] font-bold uppercase tracking-[0.06em] text-muted transition-colors hover:text-ink"
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {/* Select unique to a server */}
          <ServerPicker />

          {/* Clean up removed */}
          {removedCount > 0 && (
            <button
              onClick={() =>
                askConfirm(
                  "Clean up removed mods",
                  `${removedCount} subscribed item${removedCount === 1 ? " is" : "s are"} no longer on the Workshop. ` +
                    "Steam will remove them from your subscriptions and delete their folders from disk.",
                  () => void store.cleanupRemoved(),
                )
              }
              disabled={busy}
              title={`${removedCount} subscribed item${removedCount === 1 ? " is" : "s are"} no longer on the Workshop`}
              className="ab-btn ab-ghost flex items-center gap-1 rounded-[6px] border border-line bg-surface2 px-2 py-[5px] text-[8px] font-bold uppercase tracking-[0.04em] text-warn transition-[filter] hover:brightness-110 disabled:opacity-50"
            >
              <Trash2 className="size-3" />
              Clean up {removedCount}
            </button>
          )}
        </div>

        {/* Unsubscribe group */}
        <div className="relative flex">
          <button
            onClick={() => {
              if (selectedCount === 0) return;
              askConfirm(
                `Unsubscribe from ${selectedCount} mod${selectedCount === 1 ? "" : "s"}`,
                "Steam deletes the mod files from disk, and Workshop mods are shared — " +
                  "every server that uses them will have to download them again when you join.",
                () => void store.unsubscribeSelected(),
              );
            }}
            disabled={busy || selectedCount === 0}
            title="Unsubscribe from the selected mods (Steam deletes them from disk)"
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-l-[6px] bg-danger px-3 py-[7px] text-[10px] font-bold uppercase tracking-wider text-[#10131a] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40",
              store.op?.kind === "unsubscribe" && "animate-pulse",
            )}
          >
            {store.op?.kind === "unsubscribe" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            {store.op?.kind === "unsubscribe"
              ? store.op.note ?? "Removing…"
              : selectedCount > 0
                ? `Unsubscribe ${selectedCount}`
                : "Unsubscribe"}
          </button>
          <button
            onClick={() => setMenu(menu === "unsub" ? null : "unsub")}
            disabled={busy}
            className="flex items-center justify-center rounded-r-[6px] bg-danger px-1.5 text-[#10131a] transition-[filter] hover:brightness-110 disabled:opacity-40"
            aria-haspopup="menu"
            aria-expanded={menu === "unsub"}
          >
            <ChevronDown className={cn("size-3 transition-transform", menu === "unsub" && "rotate-180")} />
          </button>
          {menu === "unsub" && (
            <div className="absolute bottom-full right-0 mb-1 w-56 rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <MenuButton
                disabled={selectedCount === 0}
                label={selectedCount > 0 ? `Unsubscribe selected (${selectedCount})` : "Unsubscribe selected"}
                onClick={() =>
                  askConfirm(
                    `Unsubscribe from ${selectedCount} mod${selectedCount === 1 ? "" : "s"}`,
                    "Steam deletes the mod files from disk, and Workshop mods are shared — " +
                      "every server that uses them will have to download them again when you join.",
                    () => void store.unsubscribeSelected(),
                  )
                }
              />
              <MenuButton
                disabled={allCount === 0}
                label={`Unsubscribe from all ${allCount} (destructive)`}
                onClick={() =>
                  askConfirm(
                    `Unsubscribe from all ${allCount} mods`,
                    "Every subscribed mod will be removed and its files deleted from disk. " +
                      "Servers that need them will re-download them when you join.",
                    () => void store.unsubscribeAll(),
                  )
                }
              />
            </div>
          )}
        </div>

        {/* Update outdated */}
        {outdatedCount > 0 && (
          <button
            onClick={() => void store.updateAllOutdated()}
            disabled={busy}
            title={`Download the newer Workshop copy of ${outdatedCount} mod${outdatedCount === 1 ? "" : "s"}`}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[6px] border border-warn-line bg-warn-soft px-2.5 py-[7px] text-[10px] font-bold uppercase tracking-wider text-warn transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50",
              store.op?.kind === "update" && "animate-pulse",
            )}
          >
            {store.op?.kind === "update" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Download className="size-3" />
            )}
            {store.op?.kind === "update" ? store.op.note ?? "Updating…" : `Update ${outdatedCount}`}
          </button>
        )}

        {/* Verify group */}
        <div className="relative flex">
          <button
            onClick={() => {
              setMenu(null);
              void store.verifyAll();
            }}
            disabled={busy || allCount === 0}
            title="Verify every mod against the Workshop and re-download anything outdated"
            className="ab-verify flex items-center justify-center gap-1.5 rounded-l-[6px] bg-accent px-3 py-[7px] text-[10px] font-bold uppercase tracking-wider text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {store.op?.kind === "verify" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Globe className="size-3" />
            )}
            {store.op?.kind === "verify" ? store.op.note ?? "Verifying…" : "Verify mods"}
          </button>
          <button
            onClick={() => setMenu(menu === "verify" ? null : "verify")}
            disabled={busy}
            className="flex items-center justify-center rounded-r-[6px] bg-accent px-1.5 text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110 disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={menu === "verify"}
          >
            <ChevronDown className={cn("size-3 transition-transform", menu === "verify" && "rotate-180")} />
          </button>
          {menu === "verify" && (
            <div className="absolute bottom-full right-0 mb-1 w-56 rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
              <MenuButton
                disabled={selectedCount === 0}
                label={selectedCount > 0 ? `Verify selected (${selectedCount})` : "Verify selected"}
                onClick={() => {
                  if (selectedCount === 0) return;
                  setMenu(null);
                  void store.verifySelected();
                }}
              />
              <MenuButton
                disabled={allCount === 0}
                label={`Verify all (${allCount})`}
                onClick={() => {
                  setMenu(null);
                  void store.verifyAll();
                }}
              />
            </div>
          )}
        </div>
      </div>

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-80 rounded-[8px] border border-line bg-surface p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-bold text-ink">{confirm.title}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted2">{confirm.message}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-[6px] border border-line bg-surface2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirm(null);
                  confirm.action();
                }}
                className="rounded-[6px] bg-danger px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#10131a] transition-colors hover:brightness-110"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center rounded-[5px] px-3 py-2 text-left text-[11px] font-semibold text-ink transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** "Select mods unique to a server…" — pops the cared-server list. */
function ServerPicker() {
  // Narrow slice — same reasoning as ModsActionBar.
  const store = useModsStore(
    useShallow((s) => ({
      caredServers: s.caredServers,
      uniqueSource: s.uniqueSource,
      selectUniqueTo: s.selectUniqueTo,
    })),
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={store.caredServers.length === 0}
        title="Select the mods only one server uses, in case you want to prune it"
        className="ab-btn ab-ghost flex items-center gap-1 rounded-[6px] border border-line bg-surface2 px-2 py-[5px] text-[8px] font-bold uppercase tracking-[0.04em] text-muted2 transition-colors hover:text-ink disabled:opacity-50"
      >
        <Star className="size-3" />
        {store.uniqueSource ? "Unique: " + truncate(store.uniqueSource, 24) : "Select unique…"}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 max-h-64 w-80 overflow-y-auto rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
          {store.caredServers.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-muted">No favourites or recently played servers yet.</p>
          ) : (
            store.caredServers.map((srv) => {
              const label = srv.name || `${srv.addr}:${srv.query_port}`;
              return (
                <button
                  key={`${srv.addr}:${srv.query_port}`}
                  title={label}
                  onClick={() => {
                    setOpen(false);
                    void store.selectUniqueTo(srv.addr, srv.query_port, srv.name);
                  }}
                  className="flex w-full items-center gap-2 rounded-[5px] px-3 py-2 text-left transition-colors hover:bg-surface"
                >
                  <ChevronRight className="size-3 shrink-0 text-muted" />
                  <span className="min-w-0 whitespace-normal break-words text-[11px] leading-snug text-ink">
                    {label}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
