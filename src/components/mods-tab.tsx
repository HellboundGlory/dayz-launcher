import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Globe,
} from "lucide-react";
import {
  useModsStore,
  visibleRows,
  type ModSortKey,
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

/**
 * The Mods tab. Skeleton layout exactly as James specced it — filter bar on
 * top, list on the left taking most of the width, details inspector on the
 * right, selection + action buttons along the bottom — deliberately thin on
 * polish: the whole point of this first build is to exercise the backend and
 * let him iterate on the look in the next rounds.
 */

const STATUS_UI: Record<ModState, { dot: string; label: string; text?: string }> = {
  ready: { dot: "#22c55e", label: "Installed", text: "text-[#94a3b8]" },
  needs_update: { dot: "#f59e0b", label: "Update available" },
  downloading: { dot: "#38bdf8", label: "Downloading" },
  not_installed: { dot: "#64748b", label: "Not downloaded" },
  not_subscribed: { dot: "#ef4444", label: "Not subscribed" },
  not_on_workshop: { dot: "#334155", label: "Server-side" },
};

const SORT_COLUMNS: { key: ModSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "subscribed", label: "Subscribed" },
  { key: "updated", label: "Updated" },
  { key: "size", label: "Size" },
];

const STATUS_FILTERS: { key: ModStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "outdated", label: "Outdated" },
  { key: "downloading", label: "Downloading" },
  { key: "not_installed", label: "Missing" },
  { key: "disabled", label: "Disabled" },
];

function modSubscribed(mod: { time_added_to_user_list: number; install_timestamp: number }) {
  return mod.time_added_to_user_list || mod.install_timestamp || 0;
}

function sortRow(a: SubscribedMod, b: SubscribedMod, key: ModSortKey): number {
  switch (key) {
    case "name":
      return (a.title ?? "").localeCompare(b.title ?? "");
    case "subscribed":
      return modSubscribed(a) - modSubscribed(b);
    case "updated":
      return (a.time_updated ?? 0) - (b.time_updated ?? 0);
    case "size":
      return Number(a.size_on_disk || 0) - Number(b.size_on_disk || 0);
  }
}

export function ModsTab() {
  const store = useModsStore();

  const mods = useMemo(() => {
    let rows = visibleRows(store.rows);
    const q = store.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.title ?? "").toLowerCase().includes(q) ||
          (r.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
          (r.workshop_id ?? "").includes(q),
      );
    }
    if (store.statusFilter !== "all") {
      rows = rows.filter((r) => {
        const state = store.states[r.workshop_id] ?? r.state;
        switch (store.statusFilter) {
          case "outdated":
            return state === "needs_update";
          case "downloading":
            return state === "downloading";
          case "not_installed":
            return state === "not_installed" || state === "not_subscribed";
          case "disabled":
            return r.locally_disabled;
        }
      });
    }
    const dir = store.sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => sortRow(a, b, store.sortKey) * dir);
  }, [
    store.rows,
    store.states,
    store.search,
    store.statusFilter,
    store.sortKey,
    store.sortDir,
  ]);

  const selectedMod = store.rows.find((r) => r.workshop_id === store.selectedModId) ?? null;
  const removedCount = store.rows.filter((r) => r.removed).length;
  const allVisibleSelected =
    mods.length > 0 && mods.every((m) => store.selectedIds.has(m.workshop_id));

  // Load the tab on first mount, then poll live state + progress.
  useEffect(() => {
    void store.load();
    void store.loadCaredServers();
  }, []);

  useEffect(() => {
    const ids = visibleRows(store.rows).map((r) => r.workshop_id);
    if (ids.length === 0) return;
    let cancelled = false;
    async function poll() {
      try {
        const [entries, progress] = await Promise.all([
          steamModStates(ids),
          steamDownloadProgress(ids),
        ]);
        if (cancelled) return;
        store.setLive(Object.fromEntries(entries.map((e) => [e.workshop_id, e.state])));
        store.setProgress(
          Object.fromEntries(
            progress.map((p) => [
              p.workshop_id,
              { downloaded: p.downloaded, total: p.total },
            ]),
          ),
        );
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
  }, [store.rows, store.setLive, store.setProgress]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── Filter / toolbar strip ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1e293b] bg-[#0b0f17] px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-[#111823] px-2 ring-1 ring-[#1e293b]">
          <Search className="size-3 shrink-0 text-[#475569]" />
          <input
            value={store.search}
            onChange={(e) => store.setSearch(e.target.value)}
            placeholder="Search mods by name, tag or id…"
            className="min-w-0 flex-1 bg-transparent py-1 text-[11px] text-[#f1f5f9] outline-none placeholder:text-[#475569]"
          />
        </div>

        <div className="flex items-center gap-0.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => store.setStatusFilter(f.key)}
              className={cn(
                "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider",
                store.statusFilter === f.key
                  ? "bg-[#38bdf8]/15 text-[#38bdf8]"
                  : "text-[#64748b] hover:text-[#94a3b8]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => void store.load(true)}
          disabled={store.loading || !!store.op}
          title="Re-read the list and refresh details from the Workshop"
          className="flex shrink-0 items-center gap-1 rounded bg-[#111823] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] transition-colors hover:text-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3", store.loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {store.error && (
        <div className="border-b border-[#ef4444]/30 bg-[#ef4444]/5 px-3 py-1.5 text-[11px] text-[#ef4444]">
          {store.error}
        </div>
      )}
      {store.fromCache && (
        <div className="border-b border-[#f59e0b]/30 bg-[#f59e0b]/5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#f59e0b]">
          Steam unreachable — showing last known mod list
        </div>
      )}

      {/* ── Body: list + inspector ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-[#1e293b]">
          {/* header row with sortable columns */}
          <div className="grid shrink-0 items-center gap-2 border-b border-[#1e293b] bg-[#0e1520] px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#64748b]"
            style={{ gridTemplateColumns: "22px 34px minmax(0,1fr) 92px 78px 78px 62px" }}>
            <button
              onClick={() => store.setAllSelected(!allVisibleSelected)}
              className="flex items-center justify-center text-[#38bdf8] hover:text-[#7dd3fc]"
              title={allVisibleSelected ? "Deselect all" : "Select all visible"}
            >
              {allVisibleSelected ? (
                <CheckSquare className="size-3.5" />
              ) : (
                <span className="size-3.5 rounded border border-[#334155]" />
              )}
            </button>
            <span className="text-center">IMG</span>
            {SORT_COLUMNS.map((c) => (
              <button
                key={c.key}
                onClick={() => store.setSort(c.key)}
                className={cn(
                  "text-left hover:text-[#94a3b8]",
                  c.key === "name" && "text-left",
                  store.sortKey === c.key && "text-[#38bdf8]",
                )}
              >
                {c.label}
                {store.sortKey === c.key && (store.sortDir === "asc" ? " ▲" : " ▼")}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {store.loading && mods.length === 0 ? (
              <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[#64748b]">
                <Loader2 className="size-3.5 animate-spin" /> Loading subscribed mods…
              </div>
            ) : mods.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-[#64748b]">
                {store.search || store.statusFilter !== "all"
                  ? "No mods match the current filter."
                  : "You have no subscribed DayZ Workshop mods."}
              </div>
            ) : (
              mods.map((mod, i) => <ModRow key={mod.workshop_id} mod={mod} index={i} />)
            )}
          </div>
        </div>

        {/* right-hand inspector */}
        {selectedMod ? (
          <ModDetails mod={selectedMod} />
        ) : (
          <div className="hidden w-[340px] flex-col items-center justify-center bg-[#111823] p-4 text-center text-[11px] text-[#64748b] sm:flex">
            Select a mod to see its details
          </div>
        )}
      </div>

      {/* ── Bottom action bar ── */}
      <ModsActionBar removedCount={removedCount} />
    </div>
  );
}

function ModRow({ mod, index }: { mod: SubscribedMod; index: number }) {
  const store = useModsStore();
  const checked = store.selectedIds.has(mod.workshop_id);
  const state = store.states[mod.workshop_id] ?? mod.state;
  const ui = STATUS_UI[state];
  const progress = store.progress[mod.workshop_id];

  return (
    <div
      onClick={() => store.openMod(store.selectedModId === mod.workshop_id ? null : mod.workshop_id)}
      className={cn(
        "grid cursor-pointer items-center gap-2 px-3 py-1 transition-colors hover:bg-[#16202e]",
        index % 2 === 0 && "bg-[#0e1520]",
        store.selectedModId === mod.workshop_id && "bg-[#16202e] ring-1 ring-inset ring-[#38bdf8]/30",
        mod.locally_disabled && "opacity-50",
      )}
      style={{ gridTemplateColumns: "22px 34px minmax(0,1fr) 92px 78px 78px 62px" }}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          store.toggleSelected(mod.workshop_id);
        }}
        className="flex items-center justify-center"
      >
        {checked ? (
          <CheckSquare className="size-3.5 text-[#38bdf8]" />
        ) : (
          <span className="size-3.5 rounded border border-[#334155]" />
        )}
      </div>

      <div className="flex h-8 w-8 shrink-0 overflow-hidden rounded bg-[#111823] ring-1 ring-[#1e293b]">
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
          <div className="flex h-full w-full items-center justify-center text-[#475569]">
            {mod.locally_disabled ? "⏸" : "—"}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn("size-1.5 shrink-0 rounded-full", !ui && "bg-[#334155]")}
            style={ui ? { backgroundColor: ui.dot } : undefined}
          />
          <span className={cn("truncate text-[11px]", ui?.text ?? "text-[#f1f5f9]")}>
            {mod.title ?? mod.workshop_id}
          </span>
          {mod.locally_disabled && (
            <span className="shrink-0 rounded border border-[#64748b]/50 px-1 text-[8px] font-bold uppercase tracking-wider text-[#94a3b8]">
              Disabled
            </span>
          )}
        </div>
        <div className="truncate text-[9px] text-[#475569]">
          {(mod.tags ?? []).slice(0, 3).join(" · ") || mod.workshop_id}
        </div>
      </div>

      <div className="min-w-0">
        {state === "downloading" && progress ? (
          <div className="flex flex-col">
            <span className="truncate font-mono-data text-[9px] tabular-nums text-[#38bdf8]">
              {progress.total && Number(progress.total) > 0
                ? `${formatBytes(Number(progress.downloaded), 0)} / ${formatBytes(Number(progress.total), 0)}`
                : formatBytes(Number(progress.downloaded), 0)}
            </span>
            {progress.total && Number(progress.total) > 0 && (
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-[#1e293b]">
                <div
                  className="h-full bg-[#38bdf8]"
                  style={{
                    width: `${Math.min(100, (Number(progress.downloaded) / Number(progress.total)) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <span className={cn("truncate text-[10px]", ui?.text ?? "text-[#94a3b8]")}>
            {ui?.label ?? mod.state}
          </span>
        )}
      </div>

      <span className="truncate text-[10px] text-[#94a3b8]">
        {modSubscribed(mod) ? formatLastPlayed(modSubscribed(mod)) : "—"}
      </span>
      <span className="truncate text-[10px] text-[#94a3b8]">
        {mod.time_updated ? formatLastPlayed(mod.time_updated) : "—"}
      </span>
      <span className="truncate font-mono-data text-[10px] tabular-nums text-[#94a3b8]">
        {mod.size_on_disk ? formatBytes(Number(mod.size_on_disk), 1) : "—"}
      </span>
    </div>
  );
}

function ModDetails({ mod }: { mod: SubscribedMod }) {
  const store = useModsStore();
  const [reinstalling, setReinstalling] = useState(false);
  const ui = STATUS_UI[mod.state];

  function openInSteam() {
    // Resolved in Rust: the launcher locates the Steam executable and hands it
    // the steam:// URL, so a running client is focused and navigated instead of
    // relying on the OS opener's scheme handler.
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
    void store.load(true);
  }

  return (
    <div className="flex w-[340px] flex-shrink-0 flex-col overflow-y-auto bg-[#111823]">
      <div className="relative h-40 shrink-0 overflow-hidden bg-[#0e1520]">
        {mod.preview_url ? (
          <img src={mod.preview_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[#475569]">
            No preview image
          </div>
        )}
        {mod.locally_disabled && (
          <span className="absolute left-2 top-2 rounded border border-[#64748b]/60 bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#e2e8f0]">
            Disabled
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div>
          <h2 className="text-sm font-bold leading-tight text-[#f1f5f9]">{mod.title ?? mod.workshop_id}</h2>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#64748b]">
            <span
              className={cn("inline-block size-1.5 rounded-full", !ui && "bg-[#334155]")}
              style={ui ? { backgroundColor: ui.dot } : undefined}
            />
            <span className="truncate">{ui?.label ?? mod.state}</span>
            {mod.locally_disabled && <span>· locally disabled</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {(mod.tags ?? []).slice(0, 6).map((t: string) => (
            <span key={t} className="rounded bg-[#1e293b] px-1.5 py-0.5 text-[9px] text-[#94a3b8]">
              {t}
            </span>
          ))}
        </div>

        {mod.description && (
          <p className="line-clamp-6 text-[11px] leading-relaxed text-[#94a3b8]">{mod.description}</p>
        )}

        <div className="mt-1 flex flex-col gap-1 text-[10px]">
          <InfoRow label="Subscribed" value={modSubscribed(mod) ? formatLastPlayed(modSubscribed(mod)) : "—"} />
          <InfoRow label="Updated" value={mod.time_updated ? formatLastPlayed(mod.time_updated) : "—"} />
          <InfoRow label="Created" value={mod.time_created ? new Date(mod.time_created * 1000).toLocaleDateString() : "—"} />
          <InfoRow label="Size on disk" value={mod.size_on_disk ? formatBytes(Number(mod.size_on_disk), 1) : "—"} />
          <InfoRow label="Published size" value={mod.file_size ? formatBytes(mod.file_size, 1) : "—"} />
          <InfoRow label="Subscribers" value={mod.num_subscriptions ? Number(mod.num_subscriptions).toLocaleString() : "—"} />
          <InfoRow label="Rating" value={mod.num_upvotes + mod.num_downvotes ? `${mod.num_upvotes}▲ / ${mod.num_downvotes}▼` : "—"} />
          <InfoRow label="Workshop id" value={mod.workshop_id} />
          {mod.folder && <InfoRow label="Folder" value={mod.folder} />}
        </div>

        {store.needing.length > 0 && (
          <div className="border-t border-[#1e293b] pt-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#64748b]">
              Needed by {store.needing.length} favourite server{store.needing.length === 1 ? "" : "s"}
            </p>
            <div className="mt-1 flex flex-col gap-0.5">
              {store.needing.slice(0, 8).map((srv) => (
                <div key={`${srv.addr}:${srv.query_port}`} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] text-[#94a3b8]">{srv.name || `${srv.addr}:${srv.query_port}`}</span>
                  <span className="shrink-0 text-[9px] text-[#475569]">
                    {srv.last_played ? formatLastPlayed(srv.last_played) : "never"}
                  </span>
                </div>
              ))}
              {store.needing.length > 8 && (
                <span className="text-[9px] text-[#475569]">+{store.needing.length - 8} more</span>
              )}
            </div>
          </div>
        )}

        <div className="mt-1 flex flex-col gap-1.5 border-t border-[#1e293b] pt-2">
          <button
            onClick={openInSteam}
            className="flex items-center justify-center gap-1.5 rounded bg-[#16202e] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#38bdf8] ring-1 ring-[#38bdf8]/30 transition-colors hover:text-[#7dd3fc]"
          >
            <ExternalLink className="size-3" /> Open in Steam
          </button>
          <div className="flex gap-1.5">
            {mod.folder && (
              <button
                onClick={() => void openModFolder(mod.folder!)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded bg-[#16202e] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] hover:text-[#f1f5f9]"
              >
                <FolderOpen className="size-3" /> Open folder
              </button>
            )}
            <button
              onClick={() => void reinstall()}
              disabled={reinstalling}
              className="flex flex-1 items-center justify-center gap-1.5 rounded bg-[#16202e] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] hover:text-[#f1f5f9] disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", reinstalling && "animate-spin")} />
              {reinstalling ? "Reinstalling…" : "Reinstall"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#64748b]">{label}</span>
      <span className="min-w-0 truncate text-right font-mono-data text-[10px] text-[#f1f5f9]">{value}</span>
    </div>
  );
}

/** The bottom action bar: Verify + Unsubscribe, each with a revealed dropdown,
    plus the unique-per-server selection and the removed-mod clean-up. */
function ModsActionBar({ removedCount }: { removedCount: number }) {
  const store = useModsStore();
  const [menu, setMenu] = useState<"verify" | "unsub" | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const selectedCount = store.selectedIds.size;
  const allCount = visibleRows(store.rows).length;

  useEffect(() => {
    if (!menu) return;
    function onDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const busy = !!store.op;

  /**
   * The destructive-action confirm lives in-app, not in `window.confirm`:
   * WebKitGTK (the Linux webview) does not reliably show a script dialog, so a
   * native `confirm()` could silently return without confirming there and make
   * the unsubscribe buttons dead. A React modal behaves identically on both
   * platforms and matches the app's own theme.
   */
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
    <div ref={barRef} className="relative shrink-0 border-t border-[#1e293b] bg-[#0b0f17]">
      {/* Last VERIFY / unsubscribe / unique-select outcome, if there is one. */}
      {(store.verifyResult || store.mutationFailures || store.uniqueResult) && (
        <div className="flex items-center gap-2 border-b border-[#1e293b] bg-[#111823] px-3 py-1">
          {store.verifyResult && (
            <span className="text-[10px] text-[#94a3b8]">
              <span className="font-semibold text-[#f1f5f9]">{store.verifyResult.checked} checked</span>
              <span className="text-[#64748b]"> · </span>
              <span className="font-semibold text-[#f59e0b]">{store.verifyResult.outdated} outdated</span>
              <span className="text-[#64748b]"> · </span>
              <span className="font-semibold text-[#38bdf8]">{store.verifyResult.queued} re-downloading</span>
            </span>
          )}
          {store.mutationFailures && store.mutationFailures.length > 0 && (
            <span className="text-[10px] text-[#ef4444]">
              {store.mutationFailures.length} mod
              {store.mutationFailures.length === 1 ? "" : "s"} could not be removed: {store.mutationFailures[0][1]}
            </span>
          )}
          {store.mutationFailures && store.mutationFailures.length === 0 && (
            <span className="text-[10px] text-[#22c55e]">Removed ok</span>
          )}
          {store.uniqueResult &&
            (store.uniqueResult.totalUnique === 0 ? (
              <span className="text-[10px] text-[#f59e0b]">
                No mods are unique to {store.uniqueResult.server} — every mod it uses is shared
                with another favourite/recent server.
              </span>
            ) : store.uniqueResult.selected === 0 ? (
              <span className="text-[10px] text-[#f59e0b]">
                {store.uniqueResult.totalUnique} mod
                {store.uniqueResult.totalUnique === 1 ? " is" : "s are"} unique to{" "}
                {store.uniqueResult.server}, but none are in your subscribed library — nothing
                was selected.
              </span>
            ) : store.uniqueResult.selected === store.uniqueResult.totalUnique ? (
              <span className="text-[10px] text-[#94a3b8]">
                <span className="font-semibold text-[#f1f5f9]">{store.uniqueResult.selected}</span>{" "}
                unique mod{store.uniqueResult.selected === 1 ? "" : "s"} for{" "}
                {store.uniqueResult.server} selected
              </span>
            ) : (
              <span className="text-[10px] text-[#94a3b8]">
                <span className="font-semibold text-[#f1f5f9]">{store.uniqueResult.selected}</span> of{" "}
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
            className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] hover:text-[#f1f5f9]"
          >
            DISMISS
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2">
      <span className="shrink-0 text-[10px] tabular-nums text-[#64748b]">
        {selectedCount > 0 ? (
          <>
            <span className="font-semibold text-[#f1f5f9]">{selectedCount}</span> of {allCount} selected
          </>
        ) : (
          `${allCount} mod${allCount === 1 ? "" : "s"}`
        )}
      </span>
      <button
        onClick={() => store.clearSelection()}
        disabled={selectedCount === 0}
        className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] hover:text-[#f1f5f9] disabled:opacity-40"
      >
        Clear
      </button>

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
            className="flex items-center gap-1 rounded bg-[#16202e] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#f59e0b] ring-1 ring-[#1e293b] hover:text-[#fbbf24] disabled:opacity-50"
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
            "flex items-center justify-center gap-1.5 rounded-l bg-[#ef4444]/85 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0b0f17] transition-colors hover:bg-[#ef4444] disabled:cursor-not-allowed disabled:opacity-40",
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
          className="flex items-center justify-center rounded-r bg-[#ef4444]/85 px-1.5 text-[#0b0f17] transition-colors hover:bg-[#ef4444] disabled:opacity-40"
          aria-haspopup="menu"
          aria-expanded={menu === "unsub"}
        >
          <ChevronDown className={cn("size-3 transition-transform", menu === "unsub" && "rotate-180")} />
        </button>
        {menu === "unsub" && (
          <div className="absolute bottom-full right-0 mb-1 w-56 rounded border border-[#1e293b] bg-[#111823] p-1 shadow-xl">
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

      {/* Verify group */}
      <div className="relative flex">
        <button
          onClick={() => {
            setMenu(null);
            void store.verifyAll();
          }}
          disabled={busy || allCount === 0}
          title="Verify every mod against the Workshop and re-download anything outdated"
          className="flex items-center justify-center gap-1.5 rounded-l bg-[#38bdf8] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0b0f17] transition-colors hover:bg-[#7dd3fc] disabled:cursor-not-allowed disabled:opacity-50"
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
          className="flex items-center justify-center rounded-r bg-[#38bdf8] px-1.5 text-[#0b0f17] transition-colors hover:bg-[#7dd3fc] disabled:opacity-50"
          aria-haspopup="menu"
          aria-expanded={menu === "verify"}
        >
          <ChevronDown className={cn("size-3 transition-transform", menu === "verify" && "rotate-180")} />
        </button>
        {menu === "verify" && (
          <div className="absolute bottom-full right-0 mb-1 w-56 rounded border border-[#1e293b] bg-[#111823] p-1 shadow-xl">
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
            className="w-80 rounded border border-[#1e293b] bg-[#111823] p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-bold text-[#f1f5f9]">{confirm.title}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#94a3b8]">{confirm.message}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded bg-[#16202e] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] hover:text-[#f1f5f9]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirm(null);
                  confirm.action();
                }}
                className="rounded bg-[#ef4444] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0b0f17] hover:bg-[#f87171]"
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
      className="flex w-full items-center rounded px-3 py-2 text-left text-[11px] font-semibold text-[#f1f5f9] transition-colors hover:bg-[#16202e] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** "Select mods unique to a server…" — pops the cared-server list. */
function ServerPicker() {
  const store = useModsStore();
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
        className="flex items-center gap-1 rounded bg-[#16202e] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] hover:text-[#f1f5f9] disabled:opacity-50"
      >
        <Star className="size-3" />
        {store.uniqueSource ? "Unique: " + truncate(store.uniqueSource, 24) : "Select unique…"}
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 max-h-64 w-80 overflow-y-auto rounded border border-[#1e293b] bg-[#111823] p-1 shadow-xl">
          {store.caredServers.length === 0 ? (
            <p className="px-3 py-2 text-[10px] text-[#64748b]">No favourites or recently played servers yet.</p>
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
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[#16202e]"
                >
                  <ChevronRight className="size-3 shrink-0 text-[#475569]" />
                  <span className="min-w-0 whitespace-normal break-words text-[11px] leading-snug text-[#f1f5f9]">
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
