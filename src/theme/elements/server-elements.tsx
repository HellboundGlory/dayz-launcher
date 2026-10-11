import { useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import {
  Star,
  Play,
  Info,
  LoaderCircle,
  Check,
  Copy,
  Download,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Trash,
  Sun,
  Moon,
  X,
  House,
} from "lucide-react";
import type { Server } from "@/types/server";
import { cn, formatBytes, formatMultiplier, gameTimeParts, regionName } from "@/lib/utils";
import { useElementContext } from "./context";
import { useServerActions, phaseLabel } from "@/hooks/use-server-actions";
import { isOutstandingMod, useFetchesReadiness, useSelectionReadiness } from "./use-selection-readiness";
import { useServerStore } from "@/stores/server-store";
import { invalidateReadiness, setCachedReadiness } from "@/stores/readiness-store";
import {
  toggleFavourite as toggleFavouriteRemote,
  checkServerMods,
  getUniqueModsSummary,
  unsubscribeUniqueMods,
  copyServerAddress,
} from "@/lib/tauri";
import { useRowProbeStore, probeRow, rowProbeState } from "./row-probe-store";
import { useConfirm } from "@/components/confirm-dialog";
import { OptionIcon } from "./option-icon";
import { usePopupTrigger } from "../interaction/use-popup-trigger";
import { getActiveLayout, getThemeOwnedLayout, useLayoutSubscription } from "../theme-store";
import type { PopupLayoutFile } from "../renderer/types";
import { FilterPopup, usePopupContext } from "./popup-elements";
import { displayOption, formatElementTime } from "./element-utils";

export function useServerSubject(): Server | null {
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
  const server = useServerSubject();
  if (!server) return null;
  const states = serverStates(!server.online);

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
      {showQueue && queue > 0 && (
        <span data-part="queue" title={`${queue} waiting in the join queue`}>+{queue}</span>
      )}
    </>
  );

  return (
    <span
      data-el="server.players"
      data-state={states}
      className={className}
      style={style}
      title={offline ? "Last known player count — server did not respond" : undefined}
    >
      {countNode}
      {showCaption && <span data-part="caption"> players</span>}
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
  const server = useServerSubject();
  if (!server) return null;

  const offline = !server.online;
  const unknown = offline || server.ping === null;
  const pingState = unknown ? "unknown" : server.ping! <= 80 ? "good" : server.ping! <= 120 ? "fair" : "poor";
  const states = serverStates(offline, pingState);
  const pingClass =
    pingState === "unknown" ? "text-muted" : pingState === "poor" ? "text-danger" : pingState === "fair" ? "text-warn" : "text-success";
  const text = unknown ? "—" : String(server.ping);
  const showUnit = options?.showUnit === true;
  const showCaption = options?.showCaption !== false;

  return (
    <span
      data-el="server.ping"
      data-state={states}
      className={className ?? pingClass}
      style={style}
      title={offline ? "Server did not respond to the last refresh" : undefined}
    >
      <span data-part="value">{text}</span>
      {showUnit && !unknown && <span data-part="unit"> ms</span>}
      {showCaption && <span data-part="caption"> ping</span>}
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
        <span data-part="chip" data-state="offline" className={cn(chipClass, "text-danger border-danger-line")}>OFFLINE</span>
      )}
      {showOfficial && server.official && (
        <span data-part="chip" data-state="official" className={cn(chipClass, "text-accent border-accent-line")}>
          {officialWording === "official" ? "OFFICIAL" : "VANILLA"}
        </span>
      )}
      {showModded && server.modded && (
        <span data-part="chip" data-state="modded" className={cn(chipClass, "text-accent2 border-accent2-line")}>MODDED</span>
      )}
      {showFirstPerson && server.first_person && (
        <span data-part="chip" data-state="firstPerson" className={cn(chipClass, "text-muted border-line")}>1PP</span>
      )}
      {showBattleye && server.battleye && (
        <span data-part="chip" data-state="battleye" className={cn(chipClass, "text-accent border-accent-line")}>BATTLEYE</span>
      )}
      {showLocked && server.locked && (
        <span data-part="chip" data-state="locked" className={cn(chipClass, "text-danger border-danger-line")}>LOCKED</span>
      )}
      {showModUpdate && hasModUpdate && (
        <span
          data-part="chip"
          data-state="modUpdate"
          className={cn(chipClass, "text-accent border-accent-line")}
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
        <OptionIcon icon={options?.icon} fallback={Star} className={cn("size-3.5", on && "fill-current")} />
      </span>
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

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
            className="size-3"
          />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

/** Fetched readiness can turn Join into Fix and join wherever readiness is fetched. */
function ServerJoinIdleFetched({
  server,
  pending,
  disabled,
  showIcon,
  showLabel,
  optionIcon,
  onClick,
  className,
  style,
}: {
  server: Server;
  pending: boolean;
  disabled: boolean;
  showIcon: boolean;
  showLabel: boolean;
  optionIcon: unknown;
  onClick: (e: MouseEvent) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const { readiness } = useSelectionReadiness(server);
  const outstanding = readiness?.mods.some(isOutstandingMod) ?? false;
  const needsMods = server.modded && (pending || outstanding);

  return (
    <ServerJoinIdleButton
      server={server}
      label={needsMods ? "Fix and join" : "Join"}
      icon={server.modded ? "download" : "play"}
      optionIcon={optionIcon}
      needsMods={needsMods}
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
  const fetchesReadiness = useFetchesReadiness();
  const server = useServerSubject();
  const { op, dayzUp, verifyAndJoin } = useServerActions();
  const pending = useServerStore((s) => !!server && !!s.modPending[server.addr]);
  if (!server) return null;

  const wording = (options?.wording as string) ?? "join";
  const display = (options?.display as string) ?? "iconLabel";
  const isFixAndJoin = wording === "fixAndJoin";

  const activeOp = op && op.addr === server.addr ? op : null;
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    void verifyAndJoin(server);
  };

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
            <LoaderCircle className="size-3 animate-spin" />
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

  if (isFixAndJoin && fetchesReadiness) {
    return (
      <ServerJoinIdleFetched
        server={server}
        pending={pending}
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

  const needsMods = server.modded && pending;
  return (
    <ServerJoinIdleButton
      server={server}
      label={isFixAndJoin && needsMods ? "Fix and join" : "Join"}
      icon={server.modded ? "download" : "play"}
      optionIcon={options?.icon}
      needsMods={needsMods}
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
  const { openServerInfo } = useElementContext();
  const { close } = usePopupContext();
  if (!server) return null;

  const { label, showIcon, showLabel } = displayOption(options, "Server information", "icon");

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    close();
    openServerInfo(server);
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
  popupRef,
  style,
}: {
  open: boolean;
  onLoad: (e: MouseEvent) => void;
  popupRef?: RefObject<HTMLDivElement | null>;
  style?: CSSProperties;
}) {
  if (!open) return null;
  return (
    <div
      ref={popupRef}
      data-part="popup"
      role="menu"
      style={style}
      className="absolute right-0 top-full mt-1 min-w-[140px] rounded border border-line bg-surface py-1 shadow-xl"
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
  const menuKind = options?.menu === "serverLoad" ? "serverLoad" : "serverActions";
  useLayoutSubscription();
  const themedPopup = (
    menuKind === "serverActions"
      ? getActiveLayout("layout/popups/serverActions.json")
      : getThemeOwnedLayout("layout/popups/serverLoad.json")
  ) as PopupLayoutFile | undefined;
  const { open, setOpen, close, ref: rootRef, popupRef, popupStyle } = usePopupTrigger(
    { side: "bottom", align: "end" },
    themedPopup,
  );

  if (!server) return null;

  const label = (options?.label as string | undefined) ?? `More actions for ${server.name || server.addr}`;
  const disabled = menuKind === "serverLoad" && (op !== null || dayzUp);

  const handleTriggerClick = (e: MouseEvent) => {
    e.stopPropagation();
    setOpen((o) => !o);
  };

  const handleLoad = (e: MouseEvent) => {
    e.stopPropagation();
    close();
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
      <FilterPopup open={open} popupId={menuKind} close={close} themedPopup={themedPopup} triggerRef={rootRef}>
        {menuKind === "serverLoad" && (
          <ServerLoadMenuPopup open={open} onLoad={handleLoad} popupRef={popupRef} style={popupStyle} />
        )}
      </FilterPopup>
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
  const { close } = usePopupContext();
  if (!server) return null;

  const display = (options?.display as string) ?? "iconLabel";
  const label = (options?.label as string) ?? "Load to menu";
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";
  const disabled = op !== null || dayzUp;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    close();
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
          <OptionIcon icon={options?.icon} fallback={House} className="size-3.5" />
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
  const { readiness, loading } = useSelectionReadiness(server);
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
  const probe = useRowProbeStore((s) => s);
  if (!server) return null;

  const { busy, disabled } = rowProbeState(probe, server.addr, server.query_port);
  const { showIcon, showLabel } = displayOption(options, "Refresh", "icon");

  return (
    <button
      type="button"
      data-el="server.refresh"
      data-state={serverStates(!server.online, busy && "busy", disabled && "disabled")}
      disabled={disabled}
      onClick={(e) => probeRow(probe, server.addr, server.query_port, e)}
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
  const server = useServerSubject();
  if (!server) return null;

  // `addr` already carries the query port, so appending one built a three-part address.
  const showGamePort = options?.showGamePort === true;
  const states = serverStates(!server.online);

  return (
    <span data-el="server.address" data-state={states} className={className ?? "block truncate font-mono-data text-muted"} style={style}>
      <span data-part="address">{server.addr}</span>
      {showGamePort && server.game_port > 0 && <span data-part="gamePort"> game port {server.game_port}</span>}
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
  const { activeView } = useElementContext();
  if (!server) return null;

  const showNever = options?.showNever === true;
  const recentOnly = options?.recentOnly === true;
  const label = options?.label !== undefined ? String(options.label) : "played";
  const lastPlayed = server.last_played;
  if (!lastPlayed && !showNever) return null;
  if (recentOnly && activeView !== "recent") return null;

  const value = lastPlayed ? formatElementTime(lastPlayed, options?.format) : "—";
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
  const server = useServerSubject();
  if (!server) return null;

  const offline = !server.online;
  const showCaption = options?.showCaption !== false;
  const unprobed = server.mod_count === null && server.modded;
  const title = unprobed ? "This server declares mods. The mod list is fetched on refresh." : undefined;

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
    state = "none vanilla";
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
  const { close } = usePopupContext();
  if (!server) return null;

  const { label, showIcon, showLabel } = displayOption(options, "Check mods", "label");
  const disabled = busy || op !== null;

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    close();
    setBusy(true);
    try {
      const res = await checkServerMods(server.addr, server.query_port);
      setCachedReadiness(server.addr, server.query_port, res);
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
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-line bg-surface2 hover:border-accent text-ink transition-colors"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          {busy ? <LoaderCircle className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={RefreshCw} className="size-3" />}
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
  const { op, subscribeOnly } = useServerActions();
  const { close } = usePopupContext();
  if (!server) return null;

  const { label, showIcon, showLabel } = displayOption(options, "Download mods", "label");
  const busy = op?.addr === server.addr;
  const disabled = op !== null;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    close();
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
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-line bg-surface2 hover:border-accent text-ink transition-colors"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          {busy ? <LoaderCircle className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={Download} className="size-3" />}
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
  const { close } = usePopupContext();
  if (!subject) return null;
  const server = subject;

  const { label, showIcon, showLabel } = displayOption(options, "Unsubscribe unique mods", "label");
  const disabled = busy || op !== null;

  async function performUnsubscribe() {
    setBusy(true);
    try {
      const outcome = await unsubscribeUniqueMods(server.addr, server.query_port);
      invalidateReadiness();
      setNotice(
        {
          kind: "plain",
          text: `Unsubscribed ${outcome.count} unique mod${outcome.count === 1 ? "" : "s"} (${formatBytes(outcome.total_size_bytes, 1)})`,
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
    close();
    try {
      const summary = await getUniqueModsSummary(server.addr, server.query_port);
      askConfirm(
        "Unsubscribe unique mods",
        `Unsubscribe ${summary.count} unique mod${summary.count === 1 ? "" : "s"} (${formatBytes(summary.total_size_bytes, 1)}) only used by this server?`,
        () => void performUnsubscribe(),
        "Unsubscribe",
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
      className={className ?? "flex-1 py-2 px-3 text-xs font-semibold text-center border border-line bg-surface2 hover:border-accent text-ink transition-colors"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          {busy ? <LoaderCircle className="size-3 animate-spin" /> : <OptionIcon icon={options?.icon} fallback={Trash} className="size-3" />}
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

const COPY_ADDRESS_RESET_MS = 2000;

export function ServerCopyAddress({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const [copied, setCopied] = useState(false);
  const { popupId, close } = usePopupContext();
  const { setNotice } = useServerActions();
  if (!server) return null;

  const display = (options?.display as string | undefined) ?? "iconLabel";
  const label = (options?.label as string | undefined) ?? (copied ? "Address copied" : "Copy address");
  const showIcon = display === "iconLabel" || display === "icon";
  const showLabel = display === "iconLabel" || display === "label";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    close();
    void copyServerAddress(server)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_ADDRESS_RESET_MS);
        // The popup is gone, so its copied state can't show; say it in the server's notice.
        if (popupId) setNotice({ kind: "plain", text: "Address copied" }, server.addr);
      })
      .catch((err) => setNotice({ kind: "plain", text: String(err) }, server.addr));
  };

  return (
    <button
      type="button"
      data-el="server.copyAddress"
      data-state={serverStates(!server.online, copied && "copied")}
      onClick={handleClick}
      aria-label={label}
      title={showLabel ? undefined : label}
      className={className ?? "flex items-center gap-1.5 text-muted hover:text-ink"}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={copied ? Check : Copy} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ServerModUpdate({
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
  if (!modPending[server.addr]) return null;

  const label = (options?.label as string | undefined) ?? "UPDATE";
  return (
    <span data-el="server.modUpdate" data-state={serverStates(!server.online)} className={className} style={style}>
      <span data-part="label">{label}</span>
    </span>
  );
}
