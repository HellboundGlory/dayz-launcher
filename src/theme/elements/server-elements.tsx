import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Star, Play, Info, MoreHorizontal } from "lucide-react";
import type { Server } from "@/types/server";
import { cn, formatLastPlayed, formatBytes, formatMultiplier, gameTimeParts, regionName } from "@/lib/utils";
import { useElementContext } from "./context";
import { useServerActions, phaseLabel } from "@/hooks/use-server-actions";
import { useSelectionReadiness } from "./use-selection-readiness";
import { computeReadinessView } from "./readiness-elements";
import { useServerStore } from "@/stores/server-store";

function useServerSubject(): Server | null {
  const { subjectContext, selectedServer } = useElementContext();
  if (subjectContext?.kind === "server") {
    return subjectContext.data as Server;
  }
  return selectedServer;
}

/** Joins a server element's own states with the general `offline` state (SPEC: every server element). */
function serverStates(offline: boolean, ...states: (string | false | null | undefined)[]): string | undefined {
  const list = [...states, offline && "offline"].filter(Boolean) as string[];
  return list.length ? list.join(" ") : undefined;
}

/** Interleaves rendered parts with a single space, so joined text content matches the plain-string format. */
function joinParts(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, i) => (i === 0 ? [node] : [" ", node]));
}

export function ServerName({ className, style }: { className?: string; style?: CSSProperties }) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;
  const states = serverStates(!server.online);

  if (contextName === "selection") {
    return (
      <div data-el="server.name" data-state={states} className={className ?? "text-lg font-bold text-ink truncate mb-0.5"} style={style}>
        <span data-part="text">{server.name}</span>
      </div>
    );
  }

  return (
    <span data-el="server.name" data-state={states} className={className ?? "truncate"} style={style}>
      <span data-part="text">{server.name}</span>
    </span>
  );
}

export function ServerPlayers({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  const offline = !server.online;
  const countOnly = options?.format === "count";
  const showQueue = options?.showQueue !== false;
  const showCaption = options?.showCaption !== false;
  const queue = server.queue ?? 0;
  const states = serverStates(
    offline,
    server.players === 0 && "empty",
    server.players >= server.max_players && "full",
    queue > 0 && "queued",
  );

  const countNode = (
    <>
      <span data-part="value">{server.players}</span>
      {!countOnly && (
        <>
          /<span data-part="max">{server.max_players}</span>
        </>
      )}
      {showQueue && queue > 0 && <span data-part="queue"> +{queue}</span>}
    </>
  );

  if (contextName === "selection") {
    return (
      <div data-el="server.players" data-state={states} className={className} style={style}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          PLAYERS
        </div>
        <div className="text-base font-bold tabular-nums leading-none">{countNode}</div>
      </div>
    );
  }

  return (
    <span data-el="server.players" data-state={states} className={className} style={style}>
      {countNode}
      {showCaption && options?.caption ? <span data-part="caption"> {String(options.caption)}</span> : null}
    </span>
  );
}

export function ServerPing({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  const offline = !server.online;
  const unknown = offline || server.ping === null;
  const pingState = unknown ? "unknown" : server.ping! <= 80 ? "good" : server.ping! <= 120 ? "fair" : "poor";
  const states = serverStates(offline, pingState);
  const pingClass =
    pingState === "unknown" ? "text-muted" : pingState === "poor" ? "text-danger" : pingState === "fair" ? "text-warn" : "text-success";
  const text = unknown ? "—" : String(server.ping);
  const showUnit = (options?.showUnit as boolean | undefined) ?? contextName === "selection";

  if (contextName === "selection") {
    return (
      <div data-el="server.ping" data-state={states} className={className} style={style}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          PING
        </div>
        <div className={cn("text-base font-bold tabular-nums leading-none", pingClass)}>
          <span data-part="value">{text}</span>
          {showUnit && !unknown && <span data-part="unit" className="text-xs font-normal text-muted"> ms</span>}
        </div>
      </div>
    );
  }

  return (
    <span data-el="server.ping" data-state={states} className={className ?? pingClass} style={style}>
      <span data-part="value">{text}</span>
      {showUnit && !unknown && <span data-part="unit"> ms</span>}
    </span>
  );
}

export function ServerMap({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  return (
    <span data-el="server.map" data-state={serverStates(!server.online)} className={className ?? "truncate"} style={style}>
      <span data-part="text">{server.map_display}</span>
    </span>
  );
}

export function ServerGameTime({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  const offline = !server.online;
  const showIcon = options?.showIcon !== false;
  const showMultiplier = options?.showMultiplier !== false;
  const gt = gameTimeParts(server.in_game_time, server.day_multiplier, server.night_multiplier);
  const states = serverStates(offline, gt.state);
  const title = server.in_game_time
    ? `In-game: ${server.in_game_time}${server.day_multiplier != null ? ` · day ${formatMultiplier(server.day_multiplier)}` : ""}`
    : undefined;

  const nodes: ReactNode[] = [];
  if (showIcon && gt.icon) nodes.push(<span key="icon" data-part="icon">{gt.icon}</span>);
  nodes.push(<span key="time" data-part="time">{gt.time}</span>);
  if (showMultiplier && gt.multiplier) nodes.push(<span key="mult" data-part="multiplier">· {gt.multiplier}</span>);
  const content = joinParts(nodes);

  if (contextName === "selection") {
    return (
      <div data-el="server.gameTime" data-state={states} className={className} style={style} title={title}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          TIME
        </div>
        <div className="text-base font-bold tabular-nums leading-none">{content}</div>
      </div>
    );
  }

  return (
    <span data-el="server.gameTime" data-state={states} className={className} style={style} title={title}>
      {content}
    </span>
  );
}
export const ServerTime = ServerGameTime;

export function ServerTags({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const modPendingLive = useServerStore((s) => s.modPending);
  // SSR (server-elements.test.tsx renders outside a window) doesn't replay a store update through
  // useSyncExternalStore, so fall back to a direct read the way server-row-actions.tsx does.
  const modPending = typeof window === "undefined" ? useServerStore.getState().modPending : modPendingLive;
  if (!server) return null;

  const offline = !server.online;
  const hasModUpdate = !!modPending[server.addr];
  const officialWording = (options?.officialWording as string) ?? "vanilla";
  const showOffline = options?.showOffline !== false;
  const showOfficial = options?.showOfficial !== false;
  const showModded = options?.showModded !== false;
  const showFirstPerson = options?.showFirstPerson !== false;
  const showLocked = options?.showLocked !== false;
  const showModUpdate = options?.showModUpdate !== false;
  const showBattleye = options?.showBattleye === true;

  const chipClass = "border px-1 py-0.5 rounded font-semibold";

  return (
    <div data-el="server.tags" data-state={serverStates(offline)} className={className ?? "flex items-center gap-1 text-[10px]"} style={style}>
      {showOffline && offline && (
        <span data-part="chip" data-state="offline" className={cn(chipClass, "text-danger border-danger/40")}>OFFLINE</span>
      )}
      {showOfficial && server.official && (
        <span data-part="chip" data-state="official" className={cn(chipClass, "text-accent border-accent/40")}>
          {officialWording === "official" ? "OFFICIAL" : "VANILLA"}
        </span>
      )}
      {showFirstPerson && server.first_person && (
        <span data-part="chip" data-state="firstPerson" className={cn(chipClass, "text-muted border-border")}>1PP</span>
      )}
      {showModded && server.modded && (
        <span data-part="chip" data-state="modded" className={cn(chipClass, "text-accent2 border-accent2/40")}>MODDED</span>
      )}
      {showLocked && server.locked && (
        <span data-part="chip" data-state="locked" className={cn(chipClass, "text-danger border-danger/40")}>LOCKED</span>
      )}
      {showBattleye && server.battleye && (
        <span data-part="chip" data-state="battleye" className={cn(chipClass, "text-accent border-accent/40")}>BATTLEYE</span>
      )}
      {showModUpdate && hasModUpdate && (
        <span
          data-part="chip"
          data-state="modUpdate"
          className={cn(chipClass, "text-accent border-accent/40")}
          title="A declared mod has a Steam update pending"
        >
          UPDATE
        </span>
      )}
    </div>
  );
}

export function ServerFavourite({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const display = (options?.display as string) ?? "icon";
  const showLabel = display === "iconLabel";
  const label = (options?.label as string) ?? (server.favourite ? "Favourited" : "Favourite");

  if (contextName === "selection") {
    return (
      <button
        type="button"
        data-el="server.favourite"
        data-state={server.favourite ? "favourite" : undefined}
        aria-label={server.favourite ? "Remove from favourites" : "Add to favourites"}
        aria-pressed={server.favourite}
        onClick={handleClick}
        className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-border bg-surface2 hover:border-accent text-text transition-colors flex items-center justify-center gap-1.5"}
        style={style}
      >
        <Star
          className="size-3.5"
          fill={server.favourite ? "currentColor" : "none"}
        />
        <span>{server.favourite ? "Favourited" : "Favourite"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-el="server.favourite"
      data-state={server.favourite ? "favourite" : undefined}
      aria-label={server.favourite ? "Remove from favourites" : "Add to favourites"}
      aria-pressed={server.favourite}
      onClick={handleClick}
      className={className ?? "flex items-center justify-center text-muted hover:text-warn"}
      style={style}
    >
      <span data-part="icon">
        <Star
          className="size-3.5"
          fill={server.favourite ? "currentColor" : "none"}
        />
      </span>
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

/** The panel form only. Split out so the readiness hook never runs per list row,
 * where `server.readiness` is banned for the same reason (ELEMENTS.md). */
function ServerJoinSelection({
  server,
  label,
  busy,
  onClick,
  className,
  style,
}: {
  server: Server;
  label: string;
  busy: boolean;
  onClick: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { selectedServer } = useElementContext();
  const { readiness, loading } = useSelectionReadiness();

  const view = selectedServer?.addr === server.addr ? computeReadinessView(readiness, loading) : null;
  const sizeText =
    view && view.sizeBytes !== null
      ? `${view.sizeIsUpperBound ? "up to " : ""}${formatBytes(view.sizeBytes)} first`
      : null;

  return (
    <button
      type="button"
      data-el="server.join"
      data-state={busy ? "busy" : undefined}
      disabled={busy}
      onClick={onClick}
      aria-label="Fix and join"
      className={className ?? "flex items-center justify-between w-full bg-accent px-4 py-2.5 font-bold text-bg uppercase tracking-wider transition-colors hover:brightness-110 my-1"}
      style={style}
    >
      <span data-part="label">{label}</span>
      {sizeText && <span data-part="sublabel" className="text-xs font-semibold opacity-90">{sizeText}</span>}
    </button>
  );
}

export function ServerJoin({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  const { op, verifyAndJoin } = useServerActions();
  if (!server) return null;

  const wording = (options?.wording as string) ?? "join";
  const display = (options?.display as string) ?? "iconLabel";
  const isFixAndJoin = wording === "fixAndJoin";

  const activeOp = op && op.addr === server.addr ? op : null;
  const labelText = activeOp ? phaseLabel(activeOp) : isFixAndJoin ? "FIX AND JOIN" : "Join";

  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    void verifyAndJoin(server);
  };

  if (contextName === "selection" && isFixAndJoin) {
    return (
      <ServerJoinSelection
        server={server}
        label={labelText}
        busy={activeOp !== null}
        onClick={handleClick}
        className={className}
        style={style}
      />
    );
  }

  return (
    <button
      type="button"
      data-el="server.join"
      data-state={activeOp ? "busy" : undefined}
      disabled={activeOp !== null}
      onClick={handleClick}
      aria-label={labelText}
      className={className ?? "flex items-center gap-1.5 bg-accent px-3 py-1 font-semibold text-bg"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <Play className="size-3 fill-current" />
        </span>
      )}
      {showLabel && <span data-part="label">{labelText}</span>}
    </button>
  );
}

export function ServerInfo({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <button
      type="button"
      data-el="server.info"
      onClick={handleClick}
      aria-label="Server information"
      className={className ?? "text-muted hover:text-ink"}
      style={style}
    >
      <Info className="size-3.5" />
    </button>
  );
}

export function ServerMenu({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <button
      type="button"
      data-el="server.menu"
      onClick={handleClick}
      aria-label="Server actions"
      className={className ?? "text-muted hover:text-ink"}
      style={style}
    >
      <MoreHorizontal className="size-3.5" />
    </button>
  );
}

export function ServerAddress({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  // `addr` already carries the query port, so appending one built a three-part address.
  const showGamePort = options?.showGamePort === true;
  const states = serverStates(!server.online);

  if (contextName === "selection") {
    return (
      <div
        data-el="server.address"
        data-state={states}
        className={className ?? "mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted font-mono-data mb-3"}
        style={style}
      >
        <span data-part="address">{server.addr}</span>
        {showGamePort && server.game_port > 0 && <span data-part="gamePort">game port {server.game_port}</span>}
      </div>
    );
  }

  return (
    <span data-el="server.address" data-state={states} className={className ?? "block truncate font-mono-data text-muted"} style={style}>
      <span data-part="address">{server.addr}</span>
      {showGamePort && <span data-part="gamePort">:{server.game_port}</span>}
    </span>
  );
}

export function ServerLastPlayed({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  if (!server) return null;

  const showNever = options?.showNever === true;
  const label = options?.label !== undefined ? String(options.label) : "played";
  const neverPlayed = !server.last_played;
  if (neverPlayed && !showNever) return null;

  const value = neverPlayed ? "—" : formatLastPlayed(server.last_played);
  const nodes: ReactNode[] = [];
  if (label) nodes.push(<span key="label" data-part="label">{label}</span>);
  nodes.push(<span key="value" data-part="value">{value}</span>);

  return (
    <span data-el="server.lastPlayed" data-state={serverStates(!server.online)} className={className ?? "text-muted font-mono-data"} style={style}>
      {joinParts(nodes)}
    </span>
  );
}

export function ServerModCount({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  const offline = !server.online;
  const showCaption = options?.showCaption !== false;
  const unprobed = server.mod_count === null && server.modded;
  const title = unprobed ? "This server declares mods. The mod list is fetched on refresh." : undefined;

  if (contextName === "selection") {
    const value = server.mod_count !== null ? String(server.mod_count) : server.modded ? "?" : "0";
    return (
      <div data-el="server.modCount" data-state={serverStates(offline, unprobed && "unprobed")} className={className} style={style} title={title}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          MODS
        </div>
        <div data-part="value" className="text-base font-bold tabular-nums leading-none">
          {value}
        </div>
      </div>
    );
  }

  let text: string;
  let state: string | false;
  if (server.mod_count !== null) {
    text = server.mod_count === 0 ? "—" : String(server.mod_count);
    state = server.mod_count === 0 && "none";
  } else if (server.modded) {
    text = "?";
    state = "unprobed";
  } else {
    text = "—";
    state = "none";
  }

  return (
    <span data-el="server.modCount" data-state={serverStates(offline, state)} className={className ?? "font-mono-data text-muted"} style={style} title={title}>
      <span data-part="value">{text}</span>
      {showCaption && <span data-part="caption"> mods</span>}
    </span>
  );
}

export function ServerRegion({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  if (!server) return null;
  const isCode = options?.format === "code";
  const unknown = !server.country_code;
  const states = serverStates(!server.online, unknown && "unknown");

  return (
    <span
      data-el="server.region"
      data-state={states}
      className={className ?? "text-muted font-mono-data"}
      style={style}
      title={isCode ? regionName(server.country_code) : undefined}
    >
      <span data-part="text">{isCode ? (server.country_code ?? "—") : regionName(server.country_code)}</span>
    </span>
  );
}

export function ServerVersion({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  const unknown = !server.version;
  return (
    <span data-el="server.version" data-state={serverStates(!server.online, unknown && "unknown")} className={className} style={style}>
      <span data-part="text">{server.version || "unknown"}</span>
    </span>
  );
}

export function ServerCheckMods({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const label = (options?.label as string) ?? "Verify mods";
  return (
    <button
      type="button"
      data-el="server.checkMods"
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-border bg-surface2 hover:border-accent text-text transition-colors"}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

export function ServerSubscribeAll({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const label = (options?.label as string) ?? "Subscribe all";
  return (
    <button
      type="button"
      data-el="server.subscribeAll"
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-border bg-surface2 hover:border-accent text-text transition-colors"}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}

export function ServerUnsubscribeUnique({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const label = (options?.label as string) ?? "Unsubscribe all";
  return (
    <button
      type="button"
      data-el="server.unsubscribeUnique"
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-border bg-surface2 hover:border-accent text-text transition-colors"}
      style={style}
    >
      <span data-part="label">{label}</span>
    </button>
  );
}
