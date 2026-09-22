import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import {
  Star,
  Play,
  Info,
  MoreHorizontal,
  Loader2,
  Check,
  Download,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Trash2,
  Sun,
  Moon,
  X,
  Home,
} from "lucide-react";
import type { Server } from "@/types/server";
import { cn, formatLastPlayed, formatBytes, formatMultiplier, gameTimeParts, regionName } from "@/lib/utils";
import { useElementContext } from "./context";
import { useServerActions, phaseLabel } from "@/hooks/use-server-actions";
import { useSelectionReadiness } from "./use-selection-readiness";
import { computeReadinessView } from "./readiness-elements";
import { useServerStore } from "@/stores/server-store";
import { joinAction } from "@/lib/join-action";
import {
  toggleFavourite as toggleFavouriteRemote,
  refreshVisibleServers,
  checkServerMods,
  getUniqueModsSummary,
  unsubscribeUniqueMods,
} from "@/lib/tauri";
import { useRowProbeStore, probeKey } from "./row-probe-store";
import { useConfirm } from "@/components/confirm-dialog";
import { OptionIcon } from "./option-icon";

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

/** `display`/`label` resolution shared by the option-honouring action elements below.
 * `fallbackDisplay` reproduces each element's markup from before its options were wired up. */
function serverDisplayOptions(
  options: Record<string, unknown> | undefined,
  fallbackLabel: string,
  fallbackDisplay: "iconLabel" | "label" | "icon",
) {
  const display = (options?.display as string | undefined) ?? fallbackDisplay;
  const label = (options?.label as string | undefined) ?? fallbackLabel;
  return {
    label,
    showIcon: display === "iconLabel" || display === "icon",
    showLabel: display === "iconLabel" || display === "label",
  };
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
  if (showIcon && gt.icon) {
    const iconContent =
      options?.icon !== undefined ? (
        <OptionIcon icon={options.icon} fallback={gt.state === "day" ? Sun : Moon} className="inline-block size-3" />
      ) : (
        gt.icon
      );
    nodes.push(
      <span key="icon" data-part="icon">
        {iconContent}
      </span>,
    );
  }
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
  const modPending = useServerStore((s) => s.modPending);
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
  const toggleFavouriteLocal = useServerStore((s) => s.toggleFavourite);
  if (!server) return null;

  const on = server.favourite;
  const display = (options?.display as string) ?? "icon";
  const showLabel = display === "iconLabel";
  const label = (options?.label as string) ?? (on ? "Favourited" : "Favourite");

  // Optimistic: flip locally so the star responds instantly, revert on failure.
  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    const next = !on;
    toggleFavouriteLocal(server.addr);
    try {
      await toggleFavouriteRemote(server.addr, server.query_port, next);
    } catch (err) {
      console.error("Failed to persist favourite:", err);
      toggleFavouriteLocal(server.addr);
    }
  };

  const accessibleLabel = on ? "Remove from favourites" : "Add to favourites";

  return (
    <button
      type="button"
      data-el="server.favourite"
      data-state={serverStates(!server.online, on && "on")}
      aria-label={accessibleLabel}
      title={showLabel ? undefined : accessibleLabel}
      aria-pressed={on}
      onClick={handleClick}
      className={className ?? "flex items-center justify-center text-muted hover:text-warn"}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon
          icon={options?.icon}
          fallback={Star}
          className={cn(contextName === "selection" ? "size-4" : "size-3.5", on && "fill-current")}
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

// verifyAndJoin always joins once downloads finish (the setting went in v2.2.0).
const AUTO_JOIN_AFTER_DOWNLOAD = true;

function ServerJoinIdleButton({
  server,
  label,
  icon,
  optionIcon,
  needsMods,
  disabled,
  showIcon,
  showLabel,
  onClick,
  className,
  style,
}: {
  server: Server;
  label: string;
  icon: "download" | "play";
  optionIcon: unknown;
  needsMods: boolean;
  disabled: boolean;
  showIcon: boolean;
  showLabel: boolean;
  onClick: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      data-el="server.join"
      data-state={serverStates(!server.online, disabled && "disabled", server.modded && "modded", needsMods && "needsMods")}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className={className ?? "flex items-center gap-1.5 bg-accent px-3 py-1 font-semibold text-bg"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon
            icon={optionIcon}
            fallback={icon === "download" ? Download : Play}
            className={icon === "download" ? "size-3" : "size-3 fill-current"}
          />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

/** The selection idle-join form only, so `useSelectionReadiness` never runs per row — see the panel-only split above. */
function ServerJoinIdleSelection({
  server,
  disabled,
  showIcon,
  showLabel,
  optionIcon,
  onClick,
  className,
  style,
}: {
  server: Server;
  disabled: boolean;
  showIcon: boolean;
  showLabel: boolean;
  optionIcon: unknown;
  onClick: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { selectedServer } = useElementContext();
  const { readiness } = useSelectionReadiness();

  let missingCount = 0;
  let arrivingCount = 0;
  if (selectedServer?.addr === server.addr && readiness) {
    missingCount = readiness.mods.filter((m) => m.state === "not_subscribed").length;
    arrivingCount = readiness.mods.filter(
      (m) => m.state === "downloading" || m.state === "needs_update" || m.state === "not_installed",
    ).length;
  }

  const idle = joinAction({ missingCount, arrivingCount, autoJoinAfterDownload: AUTO_JOIN_AFTER_DOWNLOAD });

  return (
    <ServerJoinIdleButton
      server={server}
      label={idle.label}
      icon={idle.icon}
      optionIcon={optionIcon}
      needsMods={missingCount + arrivingCount > 0}
      disabled={disabled}
      showIcon={showIcon}
      showLabel={showLabel}
      onClick={onClick}
      className={className}
      style={style}
    />
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
  const { op, dayzUp, verifyAndJoin } = useServerActions();
  if (!server) return null;

  const wording = (options?.wording as string) ?? "join";
  const display = (options?.display as string) ?? "iconLabel";
  const isFixAndJoin = wording === "fixAndJoin";
  const isSelectionJoin = contextName === "selection" && wording === "join";

  const activeOp = op && op.addr === server.addr ? op : null;
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    void verifyAndJoin(server);
  };

  if (contextName === "selection" && isFixAndJoin) {
    const labelText = activeOp ? phaseLabel(activeOp) : "FIX AND JOIN";
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

  if (activeOp) {
    return (
      <button
        type="button"
        data-el="server.join"
        data-state={serverStates(!server.online, "busy")}
        disabled
        onClick={handleClick}
        aria-label={phaseLabel(activeOp)}
        className={className ?? "flex items-center gap-1.5 bg-accent px-3 py-1 font-semibold text-bg"}
        style={style}
      >
        {showIcon && (
          <span data-part="spinner">
            <Loader2 className="size-3 animate-spin" />
          </span>
        )}
        {showLabel && <span data-part="label">{phaseLabel(activeOp)}</span>}
      </button>
    );
  }

  if (dayzUp) {
    return (
      <button
        type="button"
        data-el="server.join"
        data-state={serverStates(!server.online, "playing")}
        disabled
        title="DayZ is running. Quit the game before joining another server."
        aria-label="Playing"
        className={className ?? "flex items-center gap-1.5 bg-accent px-3 py-1 font-semibold text-bg"}
        style={style}
      >
        {showIcon && (
          <span data-part="icon">
            <Check className="size-3" />
          </span>
        )}
        {showLabel && <span data-part="label">Playing</span>}
      </button>
    );
  }

  const disabled = op !== null || dayzUp;

  if (isSelectionJoin) {
    return (
      <ServerJoinIdleSelection
        server={server}
        disabled={disabled}
        showIcon={showIcon}
        showLabel={showLabel}
        optionIcon={options?.icon}
        onClick={handleClick}
        className={className}
        style={style}
      />
    );
  }

  return (
    <ServerJoinIdleButton
      server={server}
      label="Join"
      icon="play"
      optionIcon={options?.icon}
      needsMods={false}
      disabled={disabled}
      showIcon={showIcon}
      showLabel={showLabel}
      onClick={handleClick}
      className={className}
      style={style}
    />
  );
}

export function ServerInfo({
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

  const { label, showIcon, showLabel } = serverDisplayOptions(options, "Server information", "icon");

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <button
      type="button"
      data-el="server.info"
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "text-muted hover:text-ink"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={Info} className="size-3.5" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

/** Exported so the open/closed rendering is directly testable without simulating a click. */
export function ServerLoadMenuPopup({
  open,
  onLoad,
}: {
  open: boolean;
  onLoad: (e: MouseEvent) => void;
}) {
  if (!open) return null;
  return (
    <div
      data-part="popup"
      role="menu"
      className="absolute right-0 top-full mt-1 min-w-[140px] rounded border border-border bg-surface py-1 shadow-xl"
    >
      <button
        type="button"
        data-part="item"
        role="menuitem"
        onClick={onLoad}
        className="block w-full px-3 py-1.5 text-left text-xs hover:bg-surface2"
      >
        Load to menu
      </button>
    </div>
  );
}

export function ServerMenu({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const { op, dayzUp, verifyAndJoin } = useServerActions();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: globalThis.MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!server) return null;

  const menuKind = (options?.menu as string) ?? "serverActions";
  const label = (options?.label as string | undefined) ?? "Server actions";
  if (menuKind !== "serverLoad") {
    const handleClick = (e: MouseEvent) => {
      e.stopPropagation();
    };
    return (
      <button
        type="button"
        data-el="server.menu"
        onClick={handleClick}
        aria-label={label}
        title={label}
        className={className ?? "text-muted hover:text-ink"}
        style={style}
      >
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={MoreHorizontal} className="size-3.5" />
        </span>
      </button>
    );
  }

  const disabled = op !== null || dayzUp;

  const handleTriggerClick = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };

  const handleLoad = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    void verifyAndJoin(server, true);
  };

  return (
    <div
      ref={rootRef}
      data-el="server.menu"
      data-state={serverStates(!server.online, open && "open", disabled && "disabled")}
      className={className ?? "relative"}
      style={style}
    >
      <button
        type="button"
        data-part="trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={handleTriggerClick}
        className="text-muted hover:text-ink"
      >
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={ChevronDown} className="size-3.5" />
        </span>
      </button>
      <ServerLoadMenuPopup open={open} onLoad={handleLoad} />
    </div>
  );
}

export function ServerLoadToMenu({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const { op, dayzUp, verifyAndJoin } = useServerActions();
  if (!server) return null;

  const display = (options?.display as string) ?? "iconLabel";
  const label = (options?.label as string) ?? "Load to menu";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";
  const disabled = op !== null || dayzUp;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    void verifyAndJoin(server, true);
  };

  return (
    <button
      type="button"
      data-el="server.loadToMenu"
      data-state={serverStates(!server.online, op?.addr === server.addr ? "busy" : disabled && "disabled")}
      disabled={disabled}
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex items-center gap-1.5 text-muted hover:text-ink"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={Home} className="size-3.5" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ServerCancel({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const { op, cancelWait } = useServerActions();
  if (!server) return null;
  if (!op || op.addr !== server.addr) return null;
  if (op.phase === "launching" || op.phase === "starting") return null;

  const label = (options?.label as string) ?? "Cancel";
  const display = (options?.display as string) ?? "label";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    cancelWait();
  };

  return (
    <button
      type="button"
      data-el="server.cancel"
      data-state={serverStates(!server.online)}
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "text-muted hover:text-danger"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={X} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ServerManageMods({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { onViewChange } = useElementContext();
  const server = useServerSubject();
  const { readiness, loading } = useSelectionReadiness();
  if (!server) return null;

  const display = (options?.display as string) ?? "iconLabel";
  const label = "Manage mods";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  const count = !loading && readiness ? readiness.mods.length : server.mod_count;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onViewChange("mods");
  };

  return (
    <button
      type="button"
      data-el="server.manageMods"
      data-state={serverStates(!server.online)}
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex items-center gap-1.5 text-accent hover:brightness-110"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={ExternalLink} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
      {count !== null && <span data-part="count"> · {count} declared</span>}
    </button>
  );
}

export function ServerRefresh({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const probingKey = useRowProbeStore((s) => s.probingKey);
  const startProbe = useRowProbeStore((s) => s.startProbe);
  const endProbe = useRowProbeStore((s) => s.endProbe);
  if (!server) return null;

  const busy = probingKey === probeKey(server.addr, server.query_port);
  const disabled = probingKey !== null && !busy;
  const { showIcon, showLabel } = serverDisplayOptions(options, "Refresh", "icon");

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (probingKey !== null) return;
    startProbe(server.addr, server.query_port);
    void refreshVisibleServers([{ addr: server.addr, query_port: server.query_port }], "row").finally(() =>
      endProbe(server.addr, server.query_port),
    );
  };

  return (
    <button
      type="button"
      data-el="server.refresh"
      data-state={serverStates(!server.online, busy && "busy", disabled && "disabled")}
      disabled={disabled}
      onClick={handleClick}
      aria-label="Refresh this server"
      title={`Re-probe ${server.name || server.addr}`}
      className={className ?? "flex items-center justify-center text-muted hover:text-ink"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={RefreshCw} className={busy ? "size-3 animate-spin" : "size-3"} />
        </span>
      )}
      {showLabel && <span data-part="label">Refresh</span>}
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
  const server = useServerSubject();
  const { op, setNotice } = useServerActions();
  const mergeModPending = useServerStore((s) => s.mergeModPending);
  const triggerReload = useServerStore((s) => s.triggerReload);
  const [busy, setBusy] = useState(false);
  if (!server) return null;

  const { label, showIcon, showLabel } = serverDisplayOptions(options, "Check mods", "label");
  const disabled = busy || op !== null;

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setBusy(true);
    try {
      const res = await checkServerMods(server.addr, server.query_port);
      const hasPending = res.mods.some((m) => m.state !== "ready" && m.state !== "not_on_workshop");
      mergeModPending([{ addr: server.addr, pending: hasPending }]);
      triggerReload();
    } catch (err) {
      setNotice({ kind: "plain", text: String(err) }, server.addr);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      data-el="server.checkMods"
      data-state={serverStates(!server.online, busy && "busy")}
      disabled={disabled}
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-border bg-surface2 hover:border-accent text-text transition-colors"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={RefreshCw} className="size-3" />}
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
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
  const server = useServerSubject();
  const { op, dayzUp, subscribeOnly } = useServerActions();
  if (!server) return null;

  const { label, showIcon, showLabel } = serverDisplayOptions(options, "Download mods", "label");
  const busy = op?.addr === server.addr;
  const disabled = op !== null || dayzUp;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    void subscribeOnly(server);
  };

  return (
    <button
      type="button"
      data-el="server.subscribeAll"
      data-state={serverStates(!server.online, busy ? "busy" : disabled && "disabled")}
      disabled={disabled}
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-border bg-surface2 hover:border-accent text-text transition-colors"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={Download} className="size-3" />}
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
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
  const subject = useServerSubject();
  const { op, setNotice } = useServerActions();
  const triggerReload = useServerStore((s) => s.triggerReload);
  const askConfirm = useConfirm();
  const [busy, setBusy] = useState(false);
  if (!subject) return null;
  const server = subject;

  const { label, showIcon, showLabel } = serverDisplayOptions(options, "Unsubscribe unique mods", "label");
  const disabled = busy || op !== null;

  async function performUnsubscribe() {
    setBusy(true);
    try {
      const outcome = await unsubscribeUniqueMods(server.addr, server.query_port);
      setNotice(
        {
          kind: "plain",
          text: `Unsubscribed ${outcome.count} mod${outcome.count === 1 ? "" : "s"} (${formatBytes(outcome.total_size_bytes, 1)})`,
        },
        server.addr,
      );
      triggerReload();
    } catch (err) {
      setNotice({ kind: "plain", text: String(err) }, server.addr);
    } finally {
      setBusy(false);
    }
  }

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    try {
      const summary = await getUniqueModsSummary(server.addr, server.query_port);
      askConfirm(
        "Unsubscribe unique mods",
        `Unsubscribe ${summary.count} unique mod${summary.count === 1 ? "" : "s"} (${formatBytes(summary.total_size_bytes, 1)}) only used by this server?`,
        () => void performUnsubscribe(),
      );
    } catch (err) {
      setNotice({ kind: "plain", text: String(err) }, server.addr);
    }
  };

  return (
    <button
      type="button"
      data-el="server.unsubscribeUnique"
      data-state={serverStates(!server.online, busy ? "busy" : disabled && "disabled")}
      disabled={disabled}
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-border bg-surface2 hover:border-accent text-text transition-colors"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={Trash2} className="size-3" />}
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ServerDeselect({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const setSelectedServer = useServerStore((s) => s.setSelectedServer);
  if (!server) return null;
  const label = typeof options?.label === "string" ? options.label : "Close details";

  return (
    <button
      type="button"
      data-el="server.deselect"
      data-state={server.online ? undefined : "offline"}
      onClick={() => setSelectedServer(null)}
      aria-label={label}
      title={label}
      className={className ?? "flex shrink-0 items-center justify-center text-muted hover:text-ink"}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={X} className="size-4" />
      </span>
    </button>
  );
}
