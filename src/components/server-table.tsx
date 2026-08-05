import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  getServerList,
  refreshVisibleServers,
  toggleFavourite,
  type FilterParams,
  type SortParams,
} from "@/lib/tauri";
import type { Server } from "@/types/server";
import type { SortKey } from "@/types/filters";
import { RefreshCw } from "lucide-react";
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
  const modPending = useServerStore((s) => s.modPending);
  const hidePlaceholder = useSettingsStore((s) => s.hidePlaceholderServers);
  const englishNames = useSettingsStore((s) => s.englishNamesFilter);

  const [widths, setWidths] = useState<Widths>(loadWidths);
  /**
   * Which single row is being re-probed, as `addr:query_port`.
   *
   * One at a time on purpose: the button is for "is this one still up?", and a
   * user clicking down a column would otherwise fan out a probe per click
   * against the shared connection budget.
   */
  const [refreshingRow, setRefreshingRow] = useState<string | null>(null);
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

  const virtualItems = rowVirtualizer.getVirtualItems();

  const persist = useCallback((next: Widths) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: the layout simply won't survive a restart.
    }
  }, []);

  // Mirrors `widths` so the pointer-up handler — bound once — can read the
  // final value without the effect re-subscribing on every pixel of a drag.
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

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
      // Read through the ref rather than `setWidths((w) => { persist(w); return w; })`.
      // A state updater must be pure: React invokes it twice under StrictMode,
      // so that shape wrote to localStorage twice per drag, and any future
      // re-render triggered by an unrelated `setWidths` would have replayed it.
      persist(widthsRef.current);
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

  /**
   * Re-probe one server. Scoped as `"row"` so finishing cannot clear the main
   * REFRESH button's spinner — both raise the same completion event.
   */
  async function handleRefreshRow(server: Server) {
    const key = `${server.addr}:${server.query_port}`;
    if (refreshingRow !== null) return;
    setRefreshingRow(key);
    try {
      await refreshVisibleServers(
        [{ addr: server.addr, query_port: server.query_port }],
        "row",
      );
    } catch (e) {
      console.error("Failed to refresh server:", e);
    } finally {
      setRefreshingRow(null);
    }
  }

  /**
   * Wheel handling for the horizontal axis.
   *
   * The wheel has to keep scrolling the list vertically — it is thousands of
   * rows — so it cannot simply be reassigned. Two ways to reach sideways
   * instead, neither of which fights that:
   *
   *  - **Shift + wheel**, the universal convention, made explicit here rather
   *    than left to the browser so it behaves the same regardless of what the
   *    embedded webview decides to do with it.
   *  - **Wheel over the header row.** The header scrolls with the columns and
   *    has no vertical content of its own, so it is unambiguous — a natural
   *    place to scrub sideways without holding a modifier.
   */
  function scrollHorizontally(e: React.WheelEvent) {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    // `deltaY`, not `deltaX`: this is a normal vertical wheel being redirected.
    // `deltaX` is only non-zero on a tilt wheel or trackpad, which the browser
    // already routes to the horizontal axis by itself.
    el.scrollLeft += e.deltaY;
    e.preventDefault();
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

  // Results are applied only if this effect run is still the current one.
  //
  // Load-bearing since `get_server_list` became an async command. A synchronous
  // Tauri command runs inline on the main thread and responds before the next
  // one is dispatched, so replies could not overtake each other and the last
  // request was always the last reply. Async commands are spawned onto the
  // runtime and the query itself runs on a blocking pool, so a cheap request
  // issued second can now finish first — toggle HIDE EMPTY off then straight
  // back on and the slow unfiltered query lands *after* the fast filtered one,
  // repainting the table with rows the active filter excludes. Every dependency
  // here is high-traffic: filter edits, sort clicks, and a `loadVersion` bump
  // every 250ms while discovery streams.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const filterParams: FilterParams = {
          maps: filter.maps,
          countries: filter.countries,
          hide_empty: filter.hide_empty,
          hide_full: filter.hide_full,
          hide_locked: filter.hide_locked,
          hide_offline: filter.hide_offline,
          max_ping: filter.max_ping,
          search: filter.search,
          favourites_only: filter.favourites_only,
          recent_only: filter.recent_only,
          official: filter.official,
          modded: filter.modded,
          first_person: filter.first_person,
          // Preferences rather than view state, so they come from Settings
          // instead of the filter bar — you decide once that a nameless or
          // default-named server is not worth a row. ENGLISH ONLY joins them
          // for the same reason even though its control lives in TAGS: it is
          // on by default, so its opt-out has to survive a restart.
          hide_placeholder: hidePlaceholder,
          english_names: englishNames,
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
        if (!cancelled) setServers(rows);
      } catch (e) {
        if (!cancelled) console.error("Failed to load servers:", e);
      } finally {
        // Guarded too: a superseded run resolving late would otherwise clear the
        // spinner while the current request is still in flight.
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [filter, sortKey, sortDir, loadVersion, hidePlaceholder, englishNames]);

  // The trailing `minmax(0, 1fr)` soaks up width left over on a wide window, so
  // surplus becomes empty space on the right rather than inflating a column.
  const template = `${STAR_WIDTH}px ${COLUMNS.map((c) => `${widths[c.key]}px`).join(" ")} minmax(0, 1fr)`;
  const totalWidth = STAR_WIDTH + COLUMNS.reduce((sum, c) => sum + widths[c.key], 0);

  return (
    // One scroll container for both axes keeps the header locked to the rows
    // horizontally; the header stays put vertically via `sticky`.
    <div
      ref={scrollRef}
      onWheel={(e) => {
        if (e.shiftKey) scrollHorizontally(e);
      }}
      className="flex-1 overflow-auto"
    >
      <div style={{ minWidth: totalWidth }}>
        <div
          onWheel={scrollHorizontally}
          title="Scroll here — or hold Shift anywhere — to move the columns sideways"
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
            {/* Was "Click DISCOVER to find servers", naming a button that has
                never existed in the UI. Discovery runs by itself as soon as
                Steam connects. */}
            <span className="text-xs text-[#64748b]">
              No servers yet — the list fills in once Steam connects.
            </span>
          </div>
        )}

        {/* Sized to the full list; only the rows the viewport can see are
            actually mounted below, each pinned to its slot via translateY.
            This is what makes a 5000-row list cost the same as a 50-row one. */}
        <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
        {virtualItems.map((virtualRow) => {
          const server = servers[virtualRow.index];
          const isSelected = selectedServer?.addr === server.addr;
          const offline = !server.online;
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
                offline && "opacity-50",
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
                  {offline && <Tag color="#ef4444">OFFLINE</Tag>}
                  {server.official && <Tag color="#22c55e">OFFICIAL</Tag>}
                  {server.first_person && <Tag color="#64748b">1PP</Tag>}
                  {server.modded && <Tag color="#f59e0b">MODDED</Tag>}
                  {server.locked && <Tag color="#ef4444">LOCKED</Tag>}
                  {modPending[server.addr] && (
                    <Tag color="#38bdf8" title="A declared mod has a Steam update pending">
                      UPDATE
                    </Tag>
                  )}
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
                  title={offline ? "Last known player count — server did not respond" : undefined}
                  className={cn(
                    "font-mono-data text-[11px] tabular-nums",
                    offline
                      ? "text-[#64748b]"
                      : server.players >= server.max_players
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
                  title={offline ? "Server did not respond to the last refresh" : undefined}
                  className={cn(
                    "font-mono-data text-[11px] tabular-nums",
                    offline || server.ping === null
                      ? "text-[#64748b]"
                      : server.ping > 120
                        ? "text-[#ef4444]"
                        : server.ping > 80
                          ? "text-[#f59e0b]"
                          : "text-[#22c55e]",
                  )}
                >
                  {offline ? "—" : (server.ping ?? "—")}
                </span>
              </div>

              {/* The trailing spacer column, which had nothing in it. A probe
                  for this one server: the main REFRESH covers everything on
                  screen, which is the wrong grain when you only want to know
                  whether the server you are looking at came back up. */}
              <div className="flex items-center justify-start pl-1">
                <button
                  onClick={(e) => {
                    // Without this the click also selects the row.
                    e.stopPropagation();
                    void handleRefreshRow(server);
                  }}
                  disabled={refreshingRow !== null}
                  title={`Re-probe ${server.name || server.addr}`}
                  aria-label="Refresh this server"
                  className={cn(
                    "rounded p-1 transition-colors disabled:cursor-not-allowed",
                    refreshingRow === `${server.addr}:${server.query_port}`
                      ? "text-[#38bdf8]"
                      : "text-[#334155] hover:text-[#94a3b8] disabled:opacity-40",
                  )}
                >
                  <RefreshCw
                    className={cn(
                      "size-3",
                      refreshingRow === `${server.addr}:${server.query_port}` && "animate-spin",
                    )}
                  />
                </button>
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}

function Tag({
  color,
  title,
  children,
}: {
  color: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className="rounded border px-1 text-[8px] font-semibold uppercase leading-[1.4]"
      style={{ borderColor: `${color}66`, color }}
    >
      {children}
    </span>
  );
}
