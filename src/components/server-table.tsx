import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useServerStore } from "@/stores/server-store";
import {
  getServerList,
  toggleFavourite,
  type FilterParams,
  type SortParams,
} from "@/lib/tauri";
import type { Server } from "@/types/server";
import type { SortKey } from "@/types/filters";
import { cn, formatLastPlayed, regionName } from "@/lib/utils";

type Align = "left" | "right" | "center";

/**
 * Column geometry.
 *
 * Widths are explicit pixels rather than `fr` units. An `fr` track absorbs all
 * surplus container width, so on a maximised window the two flexible columns
 * (name at `3fr`, map at `1.1fr`) swallowed roughly 1200px between them while
 * every fixed column stayed at its narrow size — REGION was pinned at 48px and
 * truncated its own header to "REGI…". Explicit widths mean widening the window
 * adds trailing space instead of redistributing it into whichever column
 * happened to be flexible.
 *
 * `min` is the floor a drag can reach, chosen so a column can never be dragged
 * into uselessness.
 */
const COLUMNS: {
  key: string;
  label: string;
  sort?: SortKey;
  align: Align;
  width: number;
  min: number;
}[] = [
  { key: "name", label: "SERVER NAME", sort: "name", align: "left", width: 420, min: 120 },
  { key: "addr", label: "ADDRESS", align: "left", width: 156, min: 90 },
  { key: "in_game_time", label: "TIME", align: "left", width: 64, min: 48 },
  { key: "last_played", label: "LAST PLAYED", sort: "last_played", align: "left", width: 104, min: 70 },
  { key: "map_display", label: "MAP", sort: "map", align: "left", width: 148, min: 70 },
  { key: "players", label: "PLAYERS", sort: "players", align: "right", width: 84, min: 60 },
  { key: "mods", label: "MODS", sort: "mod_count", align: "right", width: 64, min: 48 },
  { key: "region", label: "REGION", align: "center", width: 76, min: 56 },
  { key: "ping", label: "PING", sort: "ping", align: "right", width: 68, min: 52 },
];

/** Width of the favourite-star gutter. Not resizable. */
const STAR_WIDTH = 32;

const STORAGE_KEY = "tetra.columnWidths.v1";

const ALIGN_CLASS: Record<Align, string> = {
  left: "justify-start text-left",
  right: "justify-end text-right",
  center: "justify-center text-center",
};

type Widths = Record<string, number>;

function defaultWidths(): Widths {
  return Object.fromEntries(COLUMNS.map((c) => [c.key, c.width]));
}

function loadWidths(): Widths {
  const base = defaultWidths();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Widths;
    // Merge rather than replace, so a stored layout from an older build that
    // predates a column still yields a width for it.
    for (const col of COLUMNS) {
      const v = saved[col.key];
      if (typeof v === "number" && Number.isFinite(v)) {
        base[col.key] = Math.max(col.min, v);
      }
    }
  } catch {
    // Corrupt or unavailable storage is not worth failing a render over.
  }
  return base;
}

/**
 * Three distinct states, previously all collapsed into "—":
 *
 *  - a number      the server was asked and answered
 *  - "?"           it declares mods but hasn't been rules-probed yet
 *  - "—"           its keywords say vanilla
 *
 * Showing "—" for the middle case is what made modded servers look mod-free.
 */
function ModCount({ server }: { server: Server }) {
  if (server.mod_count !== null) {
    return (
      <span className="font-mono-data text-[11px] tabular-nums text-[#94a3b8]">
        {server.mod_count === 0 ? "—" : server.mod_count}
      </span>
    );
  }
  if (server.modded) {
    return (
      <span
        className="font-mono-data text-[11px] text-[#f59e0b]/70"
        title="This server declares mods. The mod list is fetched on refresh."
      >
        ?
      </span>
    );
  }
  return <span className="font-mono-data text-[11px] text-[#64748b]">—</span>;
}

export function ServerTable() {
  const servers = useServerStore((s) => s.servers);
  const setServers = useServerStore((s) => s.setServers);
  const selectedServer = useServerStore((s) => s.selectedServer);
  const setSelectedServer = useServerStore((s) => s.setSelectedServer);
  const filter = useServerStore((s) => s.filter);
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const loadVersion = useServerStore((s) => s.loadVersion);
  const setLoading = useServerStore((s) => s.setLoading);
  const setSort = useServerStore((s) => s.setSort);
  const toggleFavouriteLocal = useServerStore((s) => s.toggleFavourite);

  const [widths, setWidths] = useState<Widths>(loadWidths);
  // Live drag state lives in a ref: the pointer handlers are bound once, and
  // reading the start values from state would capture them stale.
  const drag = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  // The same element scrolls both axes (see the comment on the outer div
  // below), so it also doubles as the virtualizer's scroll container.
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: servers.length,
    getScrollElement: () => scrollRef.current,
    // Rows are uniform (truncated single-line cells), but measured rather
    // than hardcoded so a future density/font change can't silently desync
    // real row height from an assumed constant.
    estimateSize: () => 29,
    overscan: 12,
  });

  const persist = useCallback((next: Widths) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: the layout simply won't survive a restart.
    }
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const col = COLUMNS.find((c) => c.key === d.key);
      if (!col) return;
      const next = Math.max(col.min, Math.round(d.startWidth + (e.clientX - d.startX)));
      setWidths((w) => (w[d.key] === next ? w : { ...w, [d.key]: next }));
    }
    function onUp() {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidths((w) => {
        persist(w);
        return w;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [persist]);

  function startResize(e: React.PointerEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key, startX: e.clientX, startWidth: widths[key] };
    // Held on <body> so the cursor doesn't flicker as the pointer leaves the
    // 5px handle mid-drag.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resetColumn(key: string) {
    const col = COLUMNS.find((c) => c.key === key);
    if (!col) return;
    const next = { ...widths, [key]: col.width };
    setWidths(next);
    persist(next);
  }

  function resetAll() {
    const next = defaultWidths();
    setWidths(next);
    persist(next);
  }

  function handleSort(key: SortKey) {
    // Same column toggles direction; a new column starts descending, which is
    // the useful default for players/mods/last-played.
    setSort(key, sortKey === key && sortDir === "desc" ? "asc" : "desc");
  }

  // Optimistic: flip it locally so the star responds instantly, then persist.
  // On failure, flip back rather than leaving the UI asserting something the
  // registry doesn't agree with.
  async function handleToggleFavourite(server: Server) {
    const next = !server.favourite;
    toggleFavouriteLocal(server.addr);
    try {
      await toggleFavourite(server.addr, server.query_port, next);
    } catch (e) {
      console.error("Failed to persist favourite:", e);
      toggleFavouriteLocal(server.addr);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const filterParams: FilterParams = {
          maps: filter.maps,
          countries: filter.countries,
          hide_empty: filter.hide_empty,
          hide_full: filter.hide_full,
          hide_locked: filter.hide_locked,
          max_ping: filter.max_ping,
          search: filter.search,
          favourites_only: filter.favourites_only,
          recent_only: filter.recent_only,
          official: filter.official,
          modded: filter.modded,
          first_person: filter.first_person,
        };
        const sortParams: SortParams = {
          sort_key: sortKey,
          sort_dir: sortDir,
          // Matches the backend's PROBE_WINDOW (src-tauri/src/commands/server.rs)
          // so every server that could have a mod_count is actually shown. Safe
          // to render at this size now that the list below is virtualised.
          limit: 5000,
        };
        const rows = await getServerList(filterParams, sortParams);
        setServers(rows);
      } catch (e) {
        console.error("Failed to load servers:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [filter, sortKey, sortDir, loadVersion]);

  // The trailing `minmax(0, 1fr)` soaks up width left over on a wide window, so
  // surplus becomes empty space on the right rather than inflating a column.
  const template = `${STAR_WIDTH}px ${COLUMNS.map((c) => `${widths[c.key]}px`).join(" ")} minmax(0, 1fr)`;
  const totalWidth = STAR_WIDTH + COLUMNS.reduce((sum, c) => sum + widths[c.key], 0);

  return (
    // One scroll container for both axes keeps the header locked to the rows
    // horizontally; the header stays put vertically via `sticky`.
    <div ref={scrollRef} className="flex-1 overflow-auto">
      <div style={{ minWidth: totalWidth }}>
        <div
          className="sticky top-0 z-10 grid items-center border-b border-[#1e293b] bg-[#111823]"
          style={{ gridTemplateColumns: template }}
        >
          <button
            onClick={resetAll}
            title="Reset column widths"
            className="flex h-full items-center justify-center text-[#334155] hover:text-[#64748b]"
          >
            <span className="text-[10px]">⟲</span>
          </button>

          {COLUMNS.map((col) => {
            const active = col.sort !== undefined && col.sort === sortKey;
            return (
              <div
                key={col.key}
                className={cn(
                  "relative flex items-center px-2 py-1.5",
                  ALIGN_CLASS[col.align],
                )}
              >
                {col.sort ? (
                  <button
                    onClick={() => handleSort(col.sort!)}
                    className={cn(
                      "flex min-w-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                      active ? "text-[#38bdf8]" : "text-[#64748b] hover:text-[#94a3b8]",
                    )}
                  >
                    <span className="truncate">{col.label}</span>
                    {active && (
                      <span className="shrink-0 text-[8px]">
                        {sortDir === "desc" ? "↓" : "↑"}
                      </span>
                    )}
                  </button>
                ) : (
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
                    {col.label}
                  </span>
                )}

                {/* Drag handle on the trailing edge. Sits above the header
                    button so a grab near the boundary resizes rather than
                    sorts. */}
                <div
                  onPointerDown={(e) => startResize(e, col.key)}
                  onDoubleClick={() => resetColumn(col.key)}
                  title="Drag to resize · double-click to reset"
                  className="group absolute right-0 top-0 z-20 h-full w-[7px] translate-x-[3px] cursor-col-resize"
                >
                  <div className="mx-auto h-full w-px bg-[#1e293b] transition-colors group-hover:bg-[#38bdf8]" />
                </div>
              </div>
            );
          })}
          <div />
        </div>

        {servers.length === 0 && (
          <div className="flex h-32 items-center justify-center">
            <span className="text-xs text-[#64748b]">Click DISCOVER to find servers</span>
          </div>
        )}

        {/* Sized to the full list; only the rows the viewport can see are
            actually mounted below, each pinned to its slot via translateY.
            This is what makes a 5000-row list cost the same as a 50-row one. */}
        <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const server = servers[virtualRow.index];
          const isSelected = selectedServer?.addr === server.addr;
          return (
            <div
              key={`${server.addr}:${server.query_port}`}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              onClick={() => setSelectedServer(server)}
              className={cn(
                "grid cursor-pointer items-center border-b border-[#1e293b]/50 transition-colors hover:bg-[#16202e]/50",
                isSelected && "bg-[#16202e] ring-1 ring-inset ring-[#38bdf8]/40",
                virtualRow.index % 2 === 0 ? "bg-[#0b0f17]/80" : "bg-[#0b0f17]",
              )}
              style={{
                gridTemplateColumns: template,
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="flex items-center justify-center">
                <button
                  onClick={(e) => {
                    // Without this the click also selects the row.
                    e.stopPropagation();
                    void handleToggleFavourite(server);
                  }}
                  title={server.favourite ? "Remove from favourites" : "Add to favourites"}
                  aria-label={server.favourite ? "Remove from favourites" : "Add to favourites"}
                  aria-pressed={server.favourite}
                  className={cn(
                    "text-xs transition-colors",
                    server.favourite
                      ? "text-[#38bdf8] hover:text-[#7dd3fc]"
                      : "text-[#334155] hover:text-[#64748b]",
                  )}
                >
                  ★
                </button>
              </div>

              {/* `min-w-0` lets the name truncate instead of widening the track. */}
              <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
                <span className="min-w-0 truncate text-xs font-medium text-[#f1f5f9]">
                  {server.name}
                </span>
                <div className="flex shrink-0 gap-0.5">
                  {server.official && <Tag color="#22c55e">OFFICIAL</Tag>}
                  {server.first_person && <Tag color="#64748b">1PP</Tag>}
                  {server.modded && <Tag color="#f59e0b">MODDED</Tag>}
                  {server.locked && <Tag color="#ef4444">LOCKED</Tag>}
                </div>
              </div>

              <div className="min-w-0 px-2 py-1.5">
                <span className="block truncate font-mono-data text-[11px] tabular-nums text-[#94a3b8]">
                  {server.addr}
                </span>
              </div>

              <div className="min-w-0 px-2 py-1.5">
                <span className="block truncate font-mono-data text-[11px] tabular-nums text-[#64748b]">
                  {server.in_game_time ?? "--:--"}
                </span>
              </div>

              <div className="min-w-0 px-2 py-1.5">
                <span className="block truncate text-[11px] text-[#64748b]">
                  {formatLastPlayed(server.last_played)}
                </span>
              </div>

              <div className="min-w-0 px-2 py-1.5">
                <span className="block truncate text-[11px] text-[#94a3b8]">
                  {server.map_display}
                </span>
              </div>

              <div className="min-w-0 px-2 py-1.5 text-right">
                <span
                  className={cn(
                    "font-mono-data text-[11px] tabular-nums",
                    server.players >= server.max_players
                      ? "text-[#f59e0b]"
                      : server.players === 0
                        ? "text-[#64748b]"
                        : "text-[#f1f5f9]",
                  )}
                >
                  {server.players}/{server.max_players}
                </span>
              </div>

              <div className="min-w-0 px-2 py-1.5 text-right">
                <ModCount server={server} />
              </div>

              <div className="min-w-0 px-2 py-1.5 text-center">
                <span
                  className="font-mono-data text-[10px] text-[#64748b]"
                  title={regionName(server.country_code)}
                >
                  {server.country_code ?? "—"}
                </span>
              </div>

              <div className="min-w-0 px-2 py-1.5 text-right">
                <span
                  className={cn(
                    "font-mono-data text-[11px] tabular-nums",
                    server.ping === null
                      ? "text-[#64748b]"
                      : server.ping > 120
                        ? "text-[#ef4444]"
                        : server.ping > 80
                          ? "text-[#f59e0b]"
                          : "text-[#22c55e]",
                  )}
                >
                  {server.ping ?? "—"}
                </span>
              </div>

              <div />
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="rounded border px-1 text-[8px] font-semibold uppercase leading-[1.4]"
      style={{ borderColor: `${color}66`, color }}
    >
      {children}
    </span>
  );
}
