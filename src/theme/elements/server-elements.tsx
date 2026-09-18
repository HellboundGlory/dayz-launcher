import type { CSSProperties, MouseEvent } from "react";
import { Star, Play, Info, MoreHorizontal } from "lucide-react";
import type { Server } from "@/types/server";
import { useElementContext } from "./context";

function useServerSubject(): Server | null {
  const { subjectContext, selectedServer } = useElementContext();
  if (subjectContext?.kind === "server") {
    return subjectContext.data as Server;
  }
  return selectedServer;
}

export function ServerName({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  return (
    <span data-el="server.name" className={className ?? "truncate"} style={style}>
      {server.name}
    </span>
  );
}

export function ServerPlayers({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  return (
    <span data-el="server.players" className={className} style={style}>
      <span data-part="current">{server.players}</span>/
      <span data-part="max">{server.max_players}</span>
    </span>
  );
}

export function ServerPing({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  return (
    <span data-el="server.ping" className={className} style={style}>
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

export function ServerTime({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;
  return (
    <span data-el="server.time" className={className} style={style}>
      {server.in_game_time ?? "—"}
    </span>
  );
}

export function ServerTags({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;

  return (
    <div data-el="server.tags" className={className ?? "flex items-center gap-1"} style={style}>
      {!server.online && <span data-part="tag" data-state="offline" className="text-danger">OFFLINE</span>}
      {server.official && <span data-part="tag" data-state="vanilla" className="text-accent">VANILLA</span>}
      {server.modded && <span data-part="tag" data-state="modded" className="text-accent2">MODDED</span>}
      {server.first_person && <span data-part="tag" data-state="1pp" className="text-muted">1PP</span>}
      {server.locked && <span data-part="tag" data-state="locked" className="text-danger">LOCKED</span>}
    </div>
  );
}

export function ServerFavourite({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

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
  const server = useServerSubject();
  if (!server) return null;

  const wording = (options?.wording as string) ?? "join";
  const display = (options?.display as string) ?? "iconLabel";
  const labelText = wording === "fixAndJoin" ? "Fix & Join" : "Join";

  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <button
      type="button"
      data-el="server.join"
      onClick={handleClick}
      aria-label={labelText}
      className={className ?? "flex items-center gap-1.5 [border-radius:var(--t-radius-controlSmall)] bg-accent px-3 py-1 font-semibold text-bg"}
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
  const server = useServerSubject();
  if (!server) return null;

  return (
    <span data-el="server.address" className={className ?? "font-mono-data text-muted"} style={style}>
      {server.addr}:{server.game_port}
    </span>
  );
}

export function ServerLastPlayed({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server || !server.last_played) return null;

  return (
    <span data-el="server.lastPlayed" className={className ?? "text-muted"} style={style}>
      Played
    </span>
  );
}

export function ServerModCount({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  if (!server) return null;

  return (
    <span data-el="server.modCount" className={className ?? "font-mono-data text-muted"} style={style}>
      {server.mod_count ?? 0} mods
    </span>
  );
}
