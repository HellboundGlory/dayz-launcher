import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useServerStore } from "@/stores/server-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Star } from "lucide-react";
import {
  getServerList,
  getMapList,
  logClient,
  toggleFavourite,
  type FilterParams,
  type SortParams,
} from "@/lib/tauri";
import type { Server } from "@/types/server";
import type { ViewId } from "./sidebar";
import { cn, formatGameTime, formatLastPlayed, regionName } from "@/lib/utils";
import { ServerRowActions } from "./server-row-actions";

interface ServerListProps {
  view: ViewId;
  onMoreInfo: (server: Server) => void;
}

/**
 * L2 rich-row server list (was `server-table.tsx` — a resizable, columned,
 * virtualized table-grid; now card rows in a vertical list). Keeps the data
 * loading, sort/filter wiring and favourite handling; the sortable column
 * headers are gone (sorting lives in the filter bar's SORT dropdown).
 */
export function ServerList({ view, onMoreInfo }: ServerListProps) {
  const servers = useServerStore((s) => s.servers);
  const setServers = useServerStore((s) => s.setServers);
  const selectedServer = useServerStore((s) => s.selectedServer);
  const setSelectedServer = useServerStore((s) => s.setSelectedServer);
  const filter = useServerStore((s) => s.filter);
  const sortKey = useServerStore((s) => s.sortKey);
  const sortDir = useServerStore((s) => s.sortDir);
  const loadVersion = useServerStore((s) => s.loadVersion);
  const setLoading = useServerStore((s) => s.setLoading);
  const setMaps = useServerStore((s) => s.setMaps);
  const setHasLoadedOnce = useServerStore((s) => s.setHasLoadedOnce);
  const toggleFavouriteLocal = useServerStore((s) => s.toggleFavourite);
  const modPending = useServerStore((s) => s.modPending);
  const hidePlaceholder = useSettingsStore((s) => s.hidePlaceholderServers);
  const englishNames = useSettingsStore((s) => s.englishNamesFilter);
  const hasLoadedOnce = useServerStore((s) => s.hasLoadedOnce);

  // Key of the row whose ⋯ menu is open. That row is lifted above its
  // siblings: virtualized rows use `transform: translateY`, so each row is a
  // stacking context and the menu's in-row z-index can never beat later rows.
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);

  // Results are applied only if this effect run is still the current one.
  //
  // Load-bearing since `get_server_list` became an async command. A synchronous
  // Tauri command runs inline on the main thread and responds before the next
  // one is dispatched, so replies could not overtake each other and the last
  // request was always the last reply. Async commands are spawned onto the
  // runtime and the query itself runs on a blocking pool, so a cheap request
  // issued second can now finish first. Every dependency here is high-traffic:
  // filter edits, sort clicks, and a `loadVersion` bump every 250ms while
  // discovery streams.
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
          // instead of the filter bar. ENGLISH ONLY joins them for the same
          // reason even though its control lives in Settings: it is on by
          // default, so its opt-out has to survive a restart.
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
        // Splash-70% diagnostic (progress.md): timelog every load so a log from
        // an affected machine shows whether reloads ran, whether they returned
        // rows, and how slow the query was.
        const t0 = performance.now();
        void logClient("servers", `load: start (loadVersion=${loadVersion})`);
        const rows = await getServerList(filterParams, sortParams);
        if (!cancelled) {
          setServers(rows);
          void logClient(
            "servers",
            `load: ${rows.length} rows in ${Math.round(performance.now() - t0)}ms (loadVersion=${loadVersion})`,
          );
        }

        // Maps are fetched alongside the rows so the drop-down updates in
        // lockstep with discovery: this effect re-runs on every `loadVersion`
        // bump, so `getMapList()` re-runs with it. Kept out of the
        // `Promise.all` with the rows so a map-query failure can never drop the
        // servers with it.
        getMapList()
          .then((maps) => {
            if (!cancelled) setMaps(maps);
          })
          .catch((e) => {
            if (!cancelled) void logClient("servers", `getMapList failed: ${String(e)}`);
          });
      } catch (e) {
        if (!cancelled) {
          void logClient("servers", `load: failed (loadVersion=${loadVersion}): ${String(e)}`);
          console.error("Failed to load servers:", e);
        }
      } finally {
        // Guarded too: a superseded run resolving late would otherwise clear the
        // spinner while the current request is still in flight. `hasLoadedOnce`
        // is guarded the same way.
        if (!cancelled) {
          setLoading(false);
          setHasLoadedOnce();
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sortKey, sortDir, loadVersion, hidePlaceholder, englishNames]);

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: servers.length,
    getScrollElement: () => scrollRef.current,
    // Row padding 8/12 + title line + meta line + the 6px flex gap between
    // rows. Measured rather than hardcoded so a density/font change can't
    // silently desync real row height from an assumed constant.
    estimateSize: () => 48,
    gap: 6,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div ref={scrollRef} className="l2-body min-h-0 flex-1 overflow-y-auto p-2">
      {servers.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <span className="text-[11px] text-muted">
            {hasLoadedOnce
              ? "No servers match the current filters."
              : "No servers yet — the list fills in once Steam connects."}
          </span>
        </div>
      ) : (
        <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
          {virtualItems.map((virtualRow) => {
            const server = servers[virtualRow.index];
            const isSelected = selectedServer?.addr === server.addr;
            const rowKey = `${server.addr}:${server.query_port}`;
            return (
              <div
                key={rowKey}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                onClick={() => setSelectedServer(server)}
                className={cn(
                  "l2-row flex cursor-pointer items-center gap-3 rounded-[8px] border border-line bg-surface px-3 py-2 transition-[border-color,background,box-shadow] duration-150",
                  "hover:border-accent-line",
                  isSelected && "border-accent-line bg-accent-soft shadow-[var(--glow)]",
                  !server.online && "opacity-50",
                )}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                  zIndex: menuOpenKey === rowKey ? 10 : undefined,
                }}
              >
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
                    "star flex shrink-0 items-center justify-center transition-colors",
                    server.favourite ? "text-warn" : "text-muted hover:text-muted2",
                  )}
                >
                  <Star
                    className="h-[14px] w-[14px]"
                    strokeWidth={1.6}
                    fill={server.favourite ? "currentColor" : "none"}
                  />
                </button>

                <div className="l2-main min-w-0 flex-1">
                  <div className="flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold">
                    <div className="flex shrink-0 gap-1">
                      {!server.online && <Tag tone="danger">OFFLINE</Tag>}
                      {server.official && <Tag tone="accent">VANILLA</Tag>}
                      {server.modded && <Tag tone="accent2">MODDED</Tag>}
                      {server.first_person && <Tag tone="muted">1PP</Tag>}
                      {server.locked && <Tag tone="danger">LOCKED</Tag>}
                      {modPending[server.addr] && (
                        <Tag tone="accent" title="A declared mod has a Steam update pending">
                          UPDATE
                        </Tag>
                      )}
                    </div>
                    <span className="min-w-0 truncate text-ink">{server.name}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2.5 whitespace-nowrap text-[9px] text-muted">
                    <span className="font-mono-data">{server.map_display}</span>
                    <span>·</span>
                    <span>
                      {formatGameTime(
                        server.in_game_time,
                        server.day_multiplier,
                        server.night_multiplier,
                      )}
                    </span>
                    <span>·</span>
                    <span>{regionName(server.country_code)}</span>
                    <span>·</span>
                    <span className="font-mono-data">{server.addr}</span>
                    {view === "recent" && server.last_played != null && (
                      <>
                        <span>·</span>
                        <span>played {formatLastPlayed(server.last_played)}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="l2-stats flex shrink-0 items-center gap-3.5">
                  <div className="l2-stat text-right">
                    <div
                      className={cn(
                        "font-mono-data text-[13px] font-bold tabular-nums leading-none",
                        !server.online || server.players === 0
                          ? "text-muted"
                          : server.players >= server.max_players
                            ? "text-warn"
                            : "text-accent2",
                      )}
                      title={
                        !server.online
                          ? "Last known player count — server did not respond"
                          : undefined
                      }
                    >
                      {server.players}/{server.max_players}
                      {server.queue != null && server.queue > 0 && (
                        <span className="text-[10px] text-warn" title={`${server.queue} waiting in the join queue`}>
                          +{server.queue}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.07em] text-muted">
                      Players
                    </div>
                  </div>
                  <div className="l2-stat text-right">
                    <div
                      className={cn(
                        "font-mono-data text-[13px] font-bold tabular-nums leading-none",
                        !server.online || server.ping === null
                          ? "text-muted"
                          : server.ping > 120
                            ? "text-danger"
                            : server.ping > 80
                              ? "text-warn"
                              : "text-success",
                      )}
                      title={
                        !server.online ? "Server did not respond to the last refresh" : undefined
                      }
                    >
                      {server.online ? (server.ping ?? "—") : "—"}
                    </div>
                    <div className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.07em] text-muted">
                      Ping
                    </div>
                  </div>
                  <div className="l2-stat text-right">
                    <ModCount server={server} />
                    <div className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.07em] text-muted">
                      Mods
                    </div>
                  </div>
                </div>

                <ServerRowActions
                  server={server}
                  onMoreInfo={onMoreInfo}
                  onOpenChange={(o) =>
                    setMenuOpenKey((cur) => (o ? rowKey : cur === rowKey ? null : cur))
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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
      <div className="font-mono-data text-[13px] font-bold tabular-nums leading-none text-accent2">
        {server.mod_count === 0 ? "—" : server.mod_count}
      </div>
    );
  }
  if (server.modded) {
    return (
      <div
        className="font-mono-data text-[13px] font-bold leading-none text-warn/80"
        title="This server declares mods. The mod list is fetched on refresh."
      >
        ?
      </div>
    );
  }
  return <div className="font-mono-data text-[13px] font-bold leading-none text-muted">—</div>;
}

type TagTone = "accent" | "accent2" | "muted" | "danger";

const TAG_CLASS: Record<TagTone, string> = {
  accent: "bg-accent-soft text-accent shadow-[var(--glow)]",
  accent2: "bg-accent2-soft text-accent2",
  muted: "bg-muted-soft text-muted2",
  danger: "bg-danger-soft text-danger",
};

function Tag({
  tone,
  title,
  children,
}: {
  tone: TagTone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block shrink-0 rounded-[4px] px-1 py-px text-[8px] font-bold uppercase leading-[1.3] tracking-[0.04em]",
        TAG_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

