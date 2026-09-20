import type { CSSProperties, MouseEvent } from "react";
import { Star, Play, Info, MoreHorizontal } from "lucide-react";
import type { Server } from "@/types/server";
import { formatLastPlayed, formatBytes, regionName } from "@/lib/utils";
import { useElementContext } from "./context";
import { useServerActions, phaseLabel } from "@/hooks/use-server-actions";
import { useSelectionReadiness } from "./use-selection-readiness";
import { computeReadinessView } from "./readiness-elements";

function useServerSubject(): Server | null {
  const { subjectContext, selectedServer } = useElementContext();
  if (subjectContext?.kind === "server") {
    return subjectContext.data as Server;
  }
  return selectedServer;
}

export function ServerName({ className, style }: { className?: string; style?: CSSProperties }) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  if (contextName === "selection") {
    return (
      <div data-el="server.name" className={className ?? "text-lg font-bold text-ink truncate mb-0.5"} style={style}>
        {server.name}
      </div>
    );
  }

  return (
    <span data-el="server.name" className={className ?? "truncate"} style={style}>
      {server.name}
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

  if (contextName === "selection") {
    return (
      <div data-el="server.players" className={className} style={style}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          PLAYERS
        </div>
        <div data-part="value" className="text-base font-bold tabular-nums leading-none">
          <span data-part="current">{server.players}</span>/<span data-part="max">{server.max_players}</span>
        </div>
      </div>
    );
  }

  const showCaption = options?.showCaption !== false;
  return (
    <span data-el="server.players" className={className} style={style}>
      <span data-part="current">{server.players}</span>/<span data-part="max">{server.max_players}</span>
      {showCaption && options?.caption ? <span> {String(options.caption)}</span> : null}
    </span>
  );
}

export function ServerPing({ className, style }: { className?: string; style?: CSSProperties }) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  if (contextName === "selection") {
    return (
      <div data-el="server.ping" className={className} style={style}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          PING
        </div>
        <div data-part="value" className="text-base font-bold tabular-nums leading-none">
          {server.ping ?? "—"} <span className="text-xs font-normal text-muted">ms</span>
        </div>
      </div>
    );
  }

  const pingClass =
    server.ping === null
      ? "text-muted"
      : server.ping > 120
        ? "text-danger"
        : server.ping > 80
          ? "text-warn"
          : "text-success";

  return (
    <span data-el="server.ping" className={className ?? pingClass} style={style}>
      <span data-part="value">{server.ping ?? "—"}</span>
    </span>
  );
}

export function ServerMap({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  return (
    <span data-el="server.map" className={className ?? "truncate"} style={style}>
      {server.map_display}
    </span>
  );
}

export function ServerGameTime({ className, style }: { className?: string; style?: CSSProperties }) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  if (contextName === "selection") {
    return (
      <div data-el="server.gameTime" className={className} style={style}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          TIME
        </div>
        <div data-part="value" className="text-base font-bold tabular-nums leading-none">
          {server.in_game_time ?? "—"}
        </div>
      </div>
    );
  }

  return (
    <span data-el="server.gameTime" className={className} style={style}>
      {server.in_game_time ?? "—"}
    </span>
  );
}
export const ServerTime = ServerGameTime;

export function ServerTags({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;

  return (
    <div data-el="server.tags" className={className ?? "flex items-center gap-1 text-[10px]"} style={style}>
      {!server.online && <span data-part="tag" data-state="offline" className="text-danger font-semibold">OFFLINE</span>}
      {server.official && <span data-part="tag" data-state="vanilla" className="text-accent border border-accent/40 px-1 py-0.5 rounded font-semibold">OFFICIAL</span>}
      {server.modded && <span data-part="tag" data-state="modded" className="text-accent2 border border-accent2/40 px-1 py-0.5 rounded font-semibold">MODDED</span>}
      {server.first_person && <span data-part="tag" data-state="1pp" className="text-muted border border-border px-1 py-0.5 rounded font-semibold">1PP</span>}
      {server.locked && <span data-part="tag" data-state="locked" className="text-danger border border-danger/40 px-1 py-0.5 rounded font-semibold">LOCKED</span>}
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

export function ServerAddress({ className, style }: { className?: string; style?: CSSProperties }) {
  const { contextName } = useElementContext();
  const server = useServerSubject();
  if (!server) return null;

  if (contextName === "selection") {
    return (
      <div data-el="server.address" className={className ?? "text-xs text-muted font-mono-data mb-3"} style={style}>
        {server.addr}:{server.game_port} · game port {server.game_port} · DayZ {server.version}
      </div>
    );
  }

  return (
    <span data-el="server.address" className={className ?? "font-mono-data text-muted"} style={style}>
      {server.addr}:{server.game_port}
    </span>
  );
}

export function ServerLastPlayed({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  const text = server.last_played ? formatLastPlayed(server.last_played) : "never";
  return (
    <span data-el="server.lastPlayed" className={className ?? "text-muted font-mono-data"} style={style}>
      {text}
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

  if (contextName === "selection") {
    return (
      <div data-el="server.modCount" className={className} style={style}>
        <div data-part="label" className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">
          MODS
        </div>
        <div data-part="value" className="text-base font-bold tabular-nums leading-none">
          {server.mod_count ?? 0}
        </div>
      </div>
    );
  }

  const showCaption = options?.showCaption !== false;
  return (
    <span data-el="server.modCount" className={className ?? "font-mono-data text-muted"} style={style}>
      {server.mod_count ?? 0}{showCaption ? " mods" : ""}
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
  return (
    <span data-el="server.region" className={className ?? "text-muted font-mono-data"} style={style}>
      {isCode ? (server.country_code ?? "—") : regionName(server.country_code)}
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
