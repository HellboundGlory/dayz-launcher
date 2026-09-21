import type { CSSProperties } from "react";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useModsStore, visibleRows, type ModStatusFilter } from "@/stores/mods-store";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";

const STATUS_FILTERS: { key: ModStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "outdated", label: "Outdated" },
  { key: "downloading", label: "Downloading" },
];

export function ModsSearch({ className, style }: { className?: string; style?: CSSProperties }) {
  const search = useModsStore((s) => s.search);
  const setSearch = useModsStore((s) => s.setSearch);

  const filled = search.trim().length > 0;

  return (
    <div
      data-el="mods.search"
      data-state={filled ? "filled" : undefined}
      className={className ?? "flex min-w-0 flex-1 items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-[5px]"}
      style={style}
    >
      <span data-part="icon" className="flex shrink-0">
        <Search className="size-3 text-muted" />
      </span>
      <input
        data-part="input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search mods by name, tag or id..."
        aria-label="Search mods"
        className="min-w-0 flex-1 bg-transparent py-0.5 [font-size:var(--t-type-body-size)] text-ink outline-none placeholder:text-muted"
      />
    </div>
  );
}

export function ModsStatusFilter({ className, style }: { className?: string; style?: CSSProperties }) {
  const statusFilter = useModsStore((s) => s.statusFilter);
  const setStatusFilter = useModsStore((s) => s.setStatusFilter);

  return (
    <div data-el="mods.statusFilter" className={className ?? "flex items-center gap-0.5"} style={style}>
      {STATUS_FILTERS.map((f) => {
        const selected = statusFilter === f.key;
        return (
          <button
            key={f.key}
            type="button"
            data-part="option"
            data-state={selected ? "selected" : undefined}
            aria-pressed={selected}
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "flex items-center justify-center [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-[5px] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider transition-colors",
              selected ? "border-accent-line bg-accent-soft text-accent" : "text-muted hover:text-ink",
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

export function ModsRefresh({ className, style }: { className?: string; style?: CSSProperties }) {
  const loading = useModsStore((s) => s.loading);
  const op = useModsStore((s) => s.op);
  const load = useModsStore((s) => s.load);
  const busy = loading || !!op;

  return (
    <button
      type="button"
      data-el="mods.refresh"
      data-state={loading ? "busy" : undefined}
      onClick={() => void load(true)}
      disabled={busy}
      title="Re-read the list and refresh details from the Workshop"
      className={className ?? "flex shrink-0 items-center gap-1 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2 py-[5px] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"}
      style={style}
    >
      <span data-part="icon" className="flex">
        <RefreshCw className={cn("size-3", loading && "animate-spin")} />
      </span>
      <span data-part="label">Refresh</span>
    </button>
  );
}

export function ModsCount({ className, style }: { className?: string; style?: CSSProperties }) {
  const { rows, selectedIds } = useModsStore(
    useShallow((s) => ({ rows: s.rows, selectedIds: s.selectedIds })),
  );
  const allCount = visibleRows(rows).length;
  const selectedCount = selectedIds.size;
  const selecting = selectedCount > 0;

  return (
    <span
      data-el="mods.count"
      data-state={selecting ? "selecting" : undefined}
      className={className ?? "shrink-0 [font-size:var(--t-type-label-size)] tabular-nums text-muted"}
      style={style}
    >
      {selecting ? (
        <>
          <span data-part="value" className="font-semibold text-ink">
            {selectedCount}
          </span>{" "}
          <span data-part="label">of {allCount} selected</span>
        </>
      ) : (
        <>
          <span data-part="value" className="font-semibold text-ink">
            {allCount}
          </span>{" "}
          <span data-part="label">mod{allCount === 1 ? "" : "s"}</span>
        </>
      )}
    </span>
  );
}

export function ModsClearSelection({ className, style }: { className?: string; style?: CSSProperties }) {
  const selectedCount = useModsStore((s) => s.selectedIds.size);
  const clearSelection = useModsStore((s) => s.clearSelection);

  return (
    <button
      type="button"
      data-el="mods.clearSelection"
      onClick={() => clearSelection()}
      disabled={selectedCount === 0}
      className={className ?? "shrink-0 [font-size:var(--t-type-caption-size)] font-bold uppercase tracking-[0.06em] text-muted transition-colors hover:text-ink disabled:opacity-40"}
      style={style}
    >
      <span data-part="label">Clear</span>
    </button>
  );
}

export function ModsCleanupRemoved({ className, style }: { className?: string; style?: CSSProperties }) {
  const rows = useModsStore((s) => s.rows);
  const op = useModsStore((s) => s.op);
  const cleanupRemoved = useModsStore((s) => s.cleanupRemoved);
  const askConfirm = useConfirm();
  const removedCount = rows.filter((r) => r.removed).length;
  const busy = !!op;

  if (removedCount === 0) return null;

  return (
    <button
      type="button"
      data-el="mods.cleanupRemoved"
      data-state={busy ? "disabled" : undefined}
      onClick={() =>
        askConfirm(
          "Clean up removed mods",
          `${removedCount} subscribed item${removedCount === 1 ? " is" : "s are"} no longer on the Workshop. ` +
            "Steam will remove them from your subscriptions and delete their folders from disk.",
          () => void cleanupRemoved(),
        )
      }
      disabled={busy}
      title={`${removedCount} subscribed item${removedCount === 1 ? " is" : "s are"} no longer on the Workshop`}
      className={className ?? "flex items-center gap-1 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2 py-[5px] [font-size:var(--t-type-micro-size)] font-bold uppercase tracking-[0.04em] text-warn transition-[filter] hover:brightness-110 disabled:opacity-50"}
      style={style}
    >
      <span data-part="icon" className="flex">
        <Trash2 className="size-3" />
      </span>
      <span data-part="label">Clean up {removedCount}</span>
    </button>
  );
}
