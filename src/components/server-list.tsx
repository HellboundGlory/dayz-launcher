import {
  Fragment,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useServerStore } from "@/stores/server-store";
import { Star } from "lucide-react";
import { toggleFavourite } from "@/lib/tauri";
import type { Server } from "@/types/server";
import type { ViewId } from "./sidebar";
import { cn, formatGameTime, formatLastPlayed, regionName } from "@/lib/utils";
import { ServerRowActions } from "./server-row-actions";

interface ServerListProps {
  view: ViewId;
  onMoreInfo: (server: Server) => void;
}

/** The row's four DOM groups. A theme reorders within one of these, never
 * across them — they are separate containers in the markup, and moving a child
 * between them would mean restructuring it. `modStatusBadge` has no group of its
 * own: it renders inside `tagsLine`'s div, on a data condition (a declared mod
 * has an update pending). `joinAction` is rendered by `server.rowActions`
 * instead. */
export const SERVER_ROW_GROUPS = {
  favourite: ["favouriteAction"],
  nameLine: ["tagsLine", "name"],
  details: ["mapLabel", "gameTimeLabel", "regionFlag", "addressLabel", "lastPlayedLabel"],
  stats: ["playerCount", "pingBadge", "modCountLabel"],
} as const;

/** The name line's render sequence: the resolved ids, plus the required
 * `modStatusBadge` promoted to its own element when a theme hid the optional
 * `tagsLine` whose div it normally rides inside. Required content must survive
 * that hide; the resolver refusing to hide required children isn't enough. */
export function nameLineSequence(ids: readonly string[], badgeVisible: boolean): string[] {
  if (!badgeVisible || ids.includes("tagsLine")) return [...ids];
  return ["modStatusBadge", ...ids];
}

/** One entry per `server.row` child this file renders, addressed by id — the
 * single description both the grouped fallback and a theme's composition tree
 * read, so neither re-describes a child's markup. `modStatusBadge` is nested in
 * `tagsLine`'s row *and* present on its own, so a tree naming both renders the
 * badge twice — the theme author's own redundant construction to avoid. */
export function serverRowNodes(
  server: Server,
  view: ViewId,
  pending: boolean,
  onToggleFavourite: (server: Server) => void,
): Partial<Record<string, ReactNode>> {
  const pendingBadge = pending ? (
    <Tag
      tone="accent"
      data-tetra-el="modStatusBadge"
      title="A declared mod has a Steam update pending"
    >
      UPDATE
    </Tag>
  ) : null;

  return {
    favouriteAction: (
      <button
        data-tetra-el="favouriteAction"
        onClick={(e) => {
          // Without this the click also selects the row.
          e.stopPropagation();
          void onToggleFavourite(server);
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
    ),
    tagsLine: (
      <div data-tetra-el="tagsLine" className="flex shrink-0 gap-1">
        {!server.online && <Tag tone="danger">OFFLINE</Tag>}
        {server.official && <Tag tone="accent">VANILLA</Tag>}
        {server.modded && <Tag tone="accent2">MODDED</Tag>}
        {server.first_person && <Tag tone="muted">1PP</Tag>}
        {server.locked && <Tag tone="danger">LOCKED</Tag>}
        {pendingBadge}
      </div>
    ),
    modStatusBadge:
      pendingBadge === null ? null : (
        <div className="flex shrink-0 gap-1">{pendingBadge}</div>
      ),
    name: (
      <span data-tetra-el="name" className="min-w-0 truncate text-ink">
        {server.name}
      </span>
    ),
    mapLabel: (
      <span data-tetra-el="mapLabel" className="font-mono-data">
        {server.map_display}
      </span>
    ),
    gameTimeLabel: (
      <span data-tetra-el="gameTimeLabel">
        {formatGameTime(server.in_game_time, server.day_multiplier, server.night_multiplier)}
      </span>
    ),
    regionFlag: (
      <span data-tetra-el="regionFlag">
        {regionName(server.country_code)}
      </span>
    ),
    addressLabel: (
      <span data-tetra-el="addressLabel" className="font-mono-data">
        {server.addr}
      </span>
    ),
    lastPlayedLabel:
      view === "recent" && server.last_played != null ? (
        <span data-tetra-el="lastPlayedLabel">
          played {formatLastPlayed(server.last_played)}
        </span>
      ) : null,
    playerCount: (
      <div className="l2-stat text-right">
        <div
          data-tetra-el="playerCount"
          className={cn(
            "font-mono-data [font-size:var(--t-type-statValue-size)] font-bold tabular-nums leading-none",
            !server.online || server.players === 0
              ? "text-muted"
              : server.players >= server.max_players
                ? "text-warn"
                : "text-accent2",
          )}
          title={
            !server.online ? "Last known player count — server did not respond" : undefined
          }
        >
          {server.players}/{server.max_players}
          {server.queue != null && server.queue > 0 && (
            <span
              className="[font-size:var(--t-type-data-size)] text-warn"
              title={`${server.queue} waiting in the join queue`}
            >
              +{server.queue}
            </span>
          )}
        </div>
        <div className="mt-0.5 [font-size:var(--t-type-statCaption-size)] font-bold uppercase [letter-spacing:var(--t-type-statCaption-tracking)] text-muted">
          Players
        </div>
      </div>
    ),
    pingBadge: (
      <div className="l2-stat text-right">
        <div
          data-tetra-el="pingBadge"
          className={cn(
            "font-mono-data [font-size:var(--t-type-statValue-size)] font-bold tabular-nums leading-none",
            !server.online || server.ping === null
              ? "text-muted"
              : server.ping > 120
                ? "text-danger"
                : server.ping > 80
                  ? "text-warn"
                  : "text-success",
          )}
          title={!server.online ? "Server did not respond to the last refresh" : undefined}
        >
          {server.online ? (server.ping ?? "—") : "—"}
        </div>
        <div className="mt-0.5 [font-size:var(--t-type-statCaption-size)] font-bold uppercase [letter-spacing:var(--t-type-statCaption-tracking)] text-muted">
          Ping
        </div>
      </div>
    ),
    modCountLabel: (
      <div data-tetra-el="modCountLabel" className="l2-stat text-right">
        <ModCount server={server} />
        <div className="mt-0.5 [font-size:var(--t-type-statCaption-size)] font-bold uppercase [letter-spacing:var(--t-type-statCaption-tracking)] text-muted">
          Mods
        </div>
      </div>
    ),
  };
}

/** One group's rendered nodes, in resolved order. A `null` entry is a child
 * whose own data condition isn't met, so it takes no position — which is what
 * keeps the detail line's separators between only what actually renders. */
function groupedNodes(
  ids: readonly string[],
  nodes: Partial<Record<string, ReactNode>>,
): { id: string; node: ReactNode }[] {
  const out: { id: string; node: ReactNode }[] = [];
  for (const id of ids) {
    const node = nodes[id];
    if (node != null) out.push({ id, node });
  }
  return out;
}

/** The name line: the badge promoted to its own element when a theme hid
 * `tagsLine`'s div, per `nameLineSequence`. */
function renderNameLine(
  ids: readonly string[],
  nodes: Partial<Record<string, ReactNode>>,
  pending: boolean,
): ReactNode {
  return groupedNodes(nameLineSequence(ids, pending), nodes).map(({ id, node }) => (
    <Fragment key={id}>{node}</Fragment>
  ));
}

/** The details line: separator-joined, like every row before it. */
function renderDetails(
  ids: readonly string[],
  nodes: Partial<Record<string, ReactNode>>,
): ReactNode {
  return groupedNodes(ids, nodes).map(({ id, node }, i) => (
    <Fragment key={id}>
      {i > 0 && <span>·</span>}
      {node}
    </Fragment>
  ));
}

/** The right-hand stats column. */
function renderStats(
  ids: readonly string[],
  nodes: Partial<Record<string, ReactNode>>,
): ReactNode {
  return groupedNodes(ids, nodes).map(({ id, node }) => <Fragment key={id}>{node}</Fragment>);
}


// Rich-row server list: data loading, sort/filter wiring, favourite handling.
export function ServerList({ view, onMoreInfo }: ServerListProps) {
  const servers = useServerStore((s) => s.servers);
  const selectedServer = useServerStore((s) => s.selectedServer);
  const setSelectedServer = useServerStore((s) => s.setSelectedServer);
  const toggleFavouriteLocal = useServerStore((s) => s.toggleFavourite);
  const modPending = useServerStore((s) => s.modPending);
  const hasLoadedOnce = useServerStore((s) => s.hasLoadedOnce);

  // Row whose ⋯ menu is open — lifted above siblings since virtualized rows
  // are each their own stacking context.
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);

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
    estimateSize: () => 48, // measured row height, not a guess
    gap: 6,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  const favouriteIds = SERVER_ROW_GROUPS.favourite;
  const nameLineIds = SERVER_ROW_GROUPS.nameLine;
  const detailIds = SERVER_ROW_GROUPS.details;
  const statIds = SERVER_ROW_GROUPS.stats;

  return (
    <div ref={scrollRef} className="l2-body min-h-0 flex-1 overflow-y-auto p-2">
      {servers.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <span className="[font-size:var(--t-type-body-size)] text-muted">
            {hasLoadedOnce
              ? "No servers match the current filters."
              : "No servers yet — the list fills in once Steam connects."}
          </span>
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            height: rowVirtualizer.getTotalSize(),
          }}
        >
          {virtualItems.map((virtualRow) => {
            const server = servers[virtualRow.index];
            const isSelected = selectedServer?.addr === server.addr;
            const rowKey = `${server.addr}:${server.query_port}`;
            const pending = !!modPending[server.addr];
            const nodes = serverRowNodes(server, view, pending, handleToggleFavourite);
            return (
              <div
                key={rowKey}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                onClick={() => setSelectedServer(server)}
                className={cn(
                  "l2-row flex cursor-pointer items-center gap-3 [border-radius:var(--t-radius-row)] border border-line bg-surface px-3 py-2 transition-[border-color,background,box-shadow] [transition-duration:var(--t-motion-hover-duration)]",
                  "hover:border-accent-line",
                  isSelected &&
                    "border-accent-line bg-accent-soft [box-shadow:var(--t-glow-selected)]",
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
                {favouriteIds.map((id) => (
                  <Fragment key={id}>{nodes[id]}</Fragment>
                ))}

                <div className="l2-main min-w-0 flex-1">
                  <div className="flex items-center gap-1 whitespace-nowrap [font-size:var(--t-type-rowName-size)] font-semibold">
                    {renderNameLine(nameLineIds, nodes, pending)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2.5 whitespace-nowrap [font-size:var(--t-type-rowMeta-size)] text-muted">
                    {renderDetails(detailIds, nodes)}
                  </div>
                </div>

                <div className="l2-stats flex shrink-0 items-center gap-3.5">
                  {renderStats(statIds, nodes)}
                </div>

                <ServerRowActions
                  server={server}
                  onMoreInfo={onMoreInfo}
                  onOpenChange={(o) =>
                    setMenuOpenKey((cur) =>
                      o ? rowKey : cur === rowKey ? null : cur,
                    )
                  }
                  modPending={pending}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Mod count: a number once probed, "?" if declared but not yet rules-probed,
    "—" only for actually vanilla — collapsing "?" into "—" hid modded servers. */
function ModCount({ server }: { server: Server }) {
  if (server.mod_count !== null) {
    return (
      <div className="font-mono-data [font-size:var(--t-type-statValue-size)] font-bold tabular-nums leading-none text-accent2">
        {server.mod_count === 0 ? "—" : server.mod_count}
      </div>
    );
  }
  if (server.modded) {
    return (
      <div
        className="font-mono-data [font-size:var(--t-type-statValue-size)] font-bold leading-none text-warn/80"
        title="This server declares mods. The mod list is fetched on refresh."
      >
        ?
      </div>
    );
  }
  return (
    <div className="font-mono-data [font-size:var(--t-type-statValue-size)] font-bold leading-none text-muted">
      —
    </div>
  );
}

type TagTone = "accent" | "accent2" | "muted" | "danger";

const TAG_CLASS: Record<TagTone, string> = {
  accent: "bg-accent-soft text-accent [box-shadow:var(--t-shadow-glow)]",
  accent2: "bg-accent2-soft text-accent2",
  muted: "bg-muted-soft text-muted2",
  danger: "bg-danger-soft text-danger",
};

function Tag({
  tone,
  title,
  children,
  "data-tetra-el": dataTetraEl,
}: {
  tone: TagTone;
  title?: string;
  children: React.ReactNode;
  "data-tetra-el"?: string;
}) {
  return (
    <span
      data-tetra-el={dataTetraEl}
      title={title}
      className={cn(
        "inline-block shrink-0 [border-radius:var(--t-radius-chip)] px-1 py-px [font-size:var(--t-type-chip-size)] font-bold uppercase [line-height:var(--t-type-chip-leading)] [letter-spacing:var(--t-type-chip-tracking)]",
        TAG_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}
