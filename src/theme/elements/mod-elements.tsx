import { useState, type CSSProperties, type MouseEvent } from "react";
import { Check, Download, ExternalLink, FolderOpen, Package, RefreshCw, X } from "lucide-react";
import { cn, formatBytes, formatLastPlayed } from "@/lib/utils";
import { useModsStore } from "@/stores/mods-store";
import { effectiveModState } from "@/components/mods-tab";
import {
  openModFolder,
  openWorkshopInSteam,
  reinstallSubscribedMod,
  type ModState,
  type ServerNeeding,
  type SubscribedMod,
} from "@/lib/tauri";
import { useElementContext } from "./context";
import { MOD_STATE_NAME } from "./list-elements";
import { OptionIcon } from "./option-icon";

function useModSubject(): SubscribedMod | null {
  const { subjectContext, selectedMod } = useElementContext();
  if (subjectContext?.kind === "mod") {
    return subjectContext.data as SubscribedMod;
  }
  return selectedMod as SubscribedMod | null;
}

/** Every mod element's own `data-state` starts with `disabled` for a locally-disabled mod. */
function modStates(mod: SubscribedMod, ...states: (string | false | null | undefined)[]): string | undefined {
  const list = [mod.locally_disabled && "disabled", ...states].filter(Boolean) as string[];
  return list.length ? list.join(" ") : undefined;
}

function useModLiveState(mod: SubscribedMod | null): ModState | undefined {
  return useModsStore((s) => (mod ? s.states[mod.workshop_id] : undefined));
}

function useModProgress(mod: SubscribedMod | null): { downloaded: string; total: string } | undefined {
  return useModsStore((s) => (mod ? s.progress[mod.workshop_id] : undefined));
}

function modSubscribedTime(mod: SubscribedMod): number {
  return mod.time_added_to_user_list || mod.install_timestamp || 0;
}

function formatModTime(unixSeconds: number, format: unknown): string {
  if (format === "date") {
    return new Date(unixSeconds * 1000).toLocaleDateString();
  }
  return formatLastPlayed(unixSeconds);
}

export function ModSelect({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  const checked = useModsStore((s) => (mod ? s.selectedIds.has(mod.workshop_id) : false));
  const toggleSelected = useModsStore((s) => s.toggleSelected);
  if (!mod) return null;

  const label = mod.title ?? mod.workshop_id;
  return (
    <button
      type="button"
      data-el="mod.select"
      data-state={modStates(mod, checked && "checked")}
      aria-pressed={checked}
      aria-label={`Select ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        toggleSelected(mod.workshop_id);
      }}
      className={className ?? "flex items-center justify-center"}
      style={style}
    >
      <span
        data-part="box"
        className={cn(
          "flex h-[13px] w-[13px] items-center justify-center [border-radius:var(--t-radius-badge)] border border-line",
          checked ? "border-accent bg-accent [color:var(--t-color-onAccent)]" : "bg-surface2",
        )}
      >
        {checked && <Check className="size-2.5 stroke-[3]" />}
      </span>
    </button>
  );
}

const MOD_STATUS_LABEL: Record<ModState, string> = {
  ready: "Installed",
  needs_update: "Update available",
  downloading: "Downloading",
  not_installed: "Not downloaded",
  not_subscribed: "Not subscribed",
  not_on_workshop: "Server-side",
};

export function ModStatus({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  const live = useModLiveState(mod);
  const progress = useModProgress(mod);
  if (!mod) return null;

  const state = effectiveModState(mod.state, live);
  const downloading = state === "downloading" && !!progress && !!progress.total && Number(progress.total) > 0;
  const label = downloading
    ? `${formatBytes(Number(progress!.downloaded), 1)} / ${formatBytes(Number(progress!.total), 1)}`
    : MOD_STATUS_LABEL[state];
  const pct = downloading
    ? Math.min(100, (Number(progress!.downloaded) / Number(progress!.total)) * 100)
    : 0;

  return (
    <span data-el="mod.status" data-state={modStates(mod, MOD_STATE_NAME[state])} className={className} style={style}>
      <span data-part="dot" />
      <span data-part="label">{label}</span>
      {downloading && <span data-part="progress" style={{ width: `${pct}%` }} />}
    </span>
  );
}

export function ModThumbnail({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;

  const missing = !mod.preview_url;
  return (
    <span data-el="mod.thumbnail" data-state={modStates(mod, missing && "missing")} className={className} style={style}>
      {mod.preview_url ? (
        <img data-part="image" src={mod.preview_url} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <Package data-part="placeholder" className="size-full text-muted" />
      )}
    </span>
  );
}

export function ModName({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;
  return (
    <span data-el="mod.name" data-state={modStates(mod)} className={className ?? "truncate"} style={style}>
      <span data-part="text">{mod.title ?? mod.workshop_id}</span>
    </span>
  );
}

export function ModDisabledBadge({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod || !mod.locally_disabled) return null;

  const label = options?.label !== undefined ? String(options.label) : "Disabled";
  return (
    <span data-el="mod.disabledBadge" data-state="disabled" className={className} style={style}>
      <span data-part="label">{label}</span>
    </span>
  );
}

export function ModTags({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod) return null;

  const limitOpt = options?.limit;
  const limit = limitOpt === "all" ? undefined : typeof limitOpt === "number" ? limitOpt : 3;
  const source = mod.tags && mod.tags.length > 0 ? mod.tags : [mod.workshop_id];
  const tags = limit !== undefined ? source.slice(0, limit) : source;
  const chips = options?.style === "chips";

  return (
    <span data-el="mod.tags" data-state={modStates(mod)} className={className} style={style}>
      {chips ? (
        tags.map((tag) => (
          <span key={tag} data-part="chip">
            {tag}
          </span>
        ))
      ) : (
        <span data-part="text">{tags.join(" · ")}</span>
      )}
    </span>
  );
}

export function ModSize({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;

  const bytes = Number(mod.size_on_disk);
  const missing = !mod.size_on_disk || !bytes;
  return (
    <span data-el="mod.size" data-state={modStates(mod, missing && "unknown")} className={className ?? "font-mono-data"} style={style}>
      <span data-part="value">{missing ? "—" : formatBytes(bytes, 1)}</span>
    </span>
  );
}

export function ModPublishedSize({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;

  const missing = !mod.file_size;
  return (
    <span data-el="mod.publishedSize" data-state={modStates(mod, missing && "unknown")} className={className ?? "font-mono-data"} style={style}>
      <span data-part="value">{missing ? "—" : formatBytes(mod.file_size, 1)}</span>
    </span>
  );
}

export function ModUpdated({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod) return null;

  const missing = !mod.time_updated;
  return (
    <span data-el="mod.updated" data-state={modStates(mod, missing && "unknown")} className={className ?? "text-muted"} style={style}>
      <span data-part="value">{missing ? "—" : formatModTime(mod.time_updated, options?.format ?? "relative")}</span>
    </span>
  );
}

export function ModSubscribed({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod) return null;

  const ts = modSubscribedTime(mod);
  const missing = !ts;
  return (
    <span data-el="mod.subscribed" data-state={modStates(mod, missing && "unknown")} className={className ?? "text-muted"} style={style}>
      <span data-part="value">{missing ? "—" : formatModTime(ts, options?.format ?? "relative")}</span>
    </span>
  );
}

export function ModCreated({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod) return null;

  const missing = !mod.time_created;
  return (
    <span data-el="mod.created" data-state={modStates(mod, missing && "unknown")} className={className ?? "text-muted"} style={style}>
      <span data-part="value">{missing ? "—" : formatModTime(mod.time_created, options?.format ?? "date")}</span>
    </span>
  );
}

export function ModSubscribers({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;

  const n = Number(mod.num_subscriptions);
  const missing = !mod.num_subscriptions || !n || Number.isNaN(n);
  return (
    <span data-el="mod.subscribers" data-state={modStates(mod, missing && "unknown")} className={className ?? "font-mono-data"} style={style}>
      <span data-part="value">{missing ? "—" : n.toLocaleString()}</span>
    </span>
  );
}

export function ModRating({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;

  const up = mod.num_upvotes ?? 0;
  const down = mod.num_downvotes ?? 0;
  const empty = up === 0 && down === 0;

  return (
    <span data-el="mod.rating" data-state={modStates(mod)} className={className} style={style}>
      {empty ? (
        "—"
      ) : (
        <>
          <span data-part="up">{up}▲</span> <span data-part="down">{down}▼</span>
        </>
      )}
    </span>
  );
}

export function ModWorkshopId({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;
  return (
    <span data-el="mod.workshopId" data-state={modStates(mod)} className={className ?? "font-mono-data"} style={style}>
      <span data-part="text">{mod.workshop_id}</span>
    </span>
  );
}

export function ModFolder({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;

  const missing = !mod.folder;
  return (
    <span data-el="mod.folder" data-state={modStates(mod, missing && "unknown")} className={className} style={style}>
      <span data-part="text">{missing ? "—" : mod.folder}</span>
    </span>
  );
}

export function ModDescription({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod) return null;

  const empty = !mod.description;
  const clampOpt = options?.clamp;
  const clamp = clampOpt === "none" ? undefined : typeof clampOpt === "number" ? clampOpt : 6;
  const clampStyle: CSSProperties | undefined =
    clamp !== undefined ? ({ "--t-line-clamp": clamp } as CSSProperties) : undefined;

  return (
    <p
      data-el="mod.description"
      data-state={modStates(mod, empty && "empty")}
      className={
        className ??
        cn(
          "text-muted",
          clamp !== undefined &&
            "[display:-webkit-box] [-webkit-box-orient:vertical] overflow-hidden [-webkit-line-clamp:var(--t-line-clamp)]",
        )
      }
      style={{ ...clampStyle, ...style }}
    >
      <span data-part="text">{empty ? "" : mod.description}</span>
    </p>
  );
}

function modDisplayOptions(options: Record<string, unknown> | undefined, fallbackLabel: string) {
  const display = (options?.display as string | undefined) ?? "label";
  const label = (options?.label as string | undefined) ?? fallbackLabel;
  return {
    label,
    showIcon: display === "iconLabel" || display === "icon",
    showLabel: display === "iconLabel" || display === "label",
  };
}

export function ModUpdate({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  const live = useModLiveState(mod);
  const op = useModsStore((s) => s.op);
  const updateMods = useModsStore((s) => s.updateMods);
  if (!mod) return null;
  if (effectiveModState(mod.state, live) !== "needs_update") return null;

  const { label, showIcon, showLabel } = modDisplayOptions(options, "Update");
  const busy = op?.kind === "update";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    void updateMods([mod.workshop_id]);
  };

  return (
    <button
      type="button"
      data-el="mod.update"
      data-state={modStates(mod, busy && "busy", busy && "disabled")}
      disabled={busy}
      aria-label={label}
      onClick={handleClick}
      className={className}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={Download} className={cn("size-3", busy && "animate-pulse")} />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ModOpenInSteam({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod) return null;

  const { label, showIcon, showLabel } = modDisplayOptions(options, "Open in Steam");

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    void openWorkshopInSteam(mod.workshop_id).catch((err) => console.error(err));
  };

  return (
    <button
      type="button"
      data-el="mod.openInSteam"
      data-state={modStates(mod)}
      aria-label={label}
      onClick={handleClick}
      className={className}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={ExternalLink} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ModOpenFolder({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  if (!mod) return null;

  const { label, showIcon, showLabel } = modDisplayOptions(options, "Open folder");
  const disabled = !mod.folder;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (mod.folder) void openModFolder(mod.folder);
  };

  return (
    <button
      type="button"
      data-el="mod.openFolder"
      data-state={modStates(mod, disabled && "disabled")}
      disabled={disabled}
      aria-label={label}
      onClick={handleClick}
      className={className}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={FolderOpen} className="size-3" />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ModReinstall({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  const load = useModsStore((s) => s.load);
  const [busy, setBusy] = useState(false);
  if (!mod) return null;

  const { label, showIcon, showLabel } = modDisplayOptions(options, "Reinstall");

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    void reinstallSubscribedMod(mod.workshop_id)
      .catch((err) => console.error(err))
      .finally(() => {
        setBusy(false);
        void load(true);
      });
  };

  return (
    <button
      type="button"
      data-el="mod.reinstall"
      data-state={modStates(mod, busy && "busy", busy && "disabled")}
      disabled={busy}
      aria-label={label}
      onClick={handleClick}
      className={className}
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={RefreshCw} className={cn("size-3", busy && "animate-spin")} />
        </span>
      )}
      {showLabel && <span data-part="label">{label}</span>}
    </button>
  );
}

export function ModDeselect({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  const openMod = useModsStore((s) => s.openMod);
  if (!mod) return null;

  const label = (options?.label as string | undefined) ?? "Close details";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    openMod(null);
  };

  return (
    <button
      type="button"
      data-el="mod.deselect"
      data-state={modStates(mod)}
      aria-label={label}
      onClick={handleClick}
      className={className}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={X} className="size-3" />
      </span>
    </button>
  );
}

export function ModNeededBy({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useModSubject();
  const needing = useModsStore((s) => s.needing);
  if (!mod || needing.length === 0) return null;

  const label = (options?.label as string | undefined) ?? "Needed by";

  return (
    <span data-el="mod.neededBy" data-state={modStates(mod)} className={className} style={style}>
      <span data-part="label">{label}</span>
      <span data-part="value">{needing.length}</span>
    </span>
  );
}

function useModServerSubject(): ServerNeeding | null {
  const { subjectContext } = useElementContext();
  if (subjectContext?.kind === "modServer") {
    return subjectContext.data as ServerNeeding;
  }
  return null;
}

export function ModServerName({ className, style }: { className?: string; style?: CSSProperties }) {
  const srv = useModServerSubject();
  if (!srv) return null;
  return (
    <span data-el="modServer.name" className={className ?? "truncate"} style={style}>
      <span data-part="text">{srv.name || `${srv.addr}:${srv.query_port}`}</span>
    </span>
  );
}

export function ModServerAddress({ className, style }: { className?: string; style?: CSSProperties }) {
  const srv = useModServerSubject();
  if (!srv) return null;
  return (
    <span data-el="modServer.address" className={className ?? "truncate font-mono-data"} style={style}>
      <span data-part="text">{`${srv.addr}:${srv.query_port}`}</span>
    </span>
  );
}

export function ModServerLastPlayed({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const srv = useModServerSubject();
  if (!srv) return null;

  const label = options?.label !== undefined ? String(options.label) : undefined;
  const never = srv.last_played === null;
  const value = never ? "never" : formatModTime(srv.last_played!, options?.format ?? "relative");

  return (
    <span data-el="modServer.lastPlayed" data-state={never ? "never" : undefined} className={className} style={style}>
      {label && <span data-part="label">{label}</span>}
      <span data-part="value">{value}</span>
    </span>
  );
}

export interface ServerModData {
  workshop_id?: string;
  name?: string;
  state?: string;
  size_bytes?: number | null;
}

function useServerModSubject(): ServerModData | null {
  const { subjectContext } = useElementContext();
  if (subjectContext?.kind === "serverMod") {
    return subjectContext.data as ServerModData;
  }
  return null;
}

export function ServerModState({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const mod = useServerModSubject();
  if (!mod) return null;

  const display = (options?.display as string) ?? "label";
  const state = mod.state ?? "ready";

  if (display === "dot") {
    if (state === "ready") {
      return <span data-el="serverMod.state" data-part="dot" className={className ?? "text-success font-bold text-xs mr-2"} style={style}>✓</span>;
    }
    if (state === "needs_update" || state === "update") {
      return <span data-el="serverMod.state" data-part="dot" className={className ?? "text-warn font-bold text-xs mr-2"} style={style}>↓</span>;
    }
    if (state === "not_subscribed") {
      return <span data-el="serverMod.state" data-part="dot" className={className ?? "text-danger font-bold text-xs mr-2"} style={style}>+</span>;
    }
    return <span data-el="serverMod.state" data-part="dot" className={className ?? "text-muted font-bold text-xs mr-2"} style={style}>·</span>;
  }

  if (state === "ready") {
    return <span data-el="serverMod.state" data-part="label" className={className ?? "text-muted font-mono-data text-xs"} style={style}>ready</span>;
  }
  if (state === "needs_update" || state === "update") {
    const sizeStr = mod.size_bytes ? ` ${formatBytes(mod.size_bytes)}` : "";
    return <span data-el="serverMod.state" data-part="label" className={className ?? "text-warn font-mono-data text-xs font-semibold"} style={style}>update{sizeStr}</span>;
  }
  if (state === "not_subscribed") {
    return <span data-el="serverMod.state" data-part="label" className={className ?? "text-danger font-mono-data text-xs font-semibold"} style={style}>not subscribed</span>;
  }

  return <span data-el="serverMod.state" data-part="label" className={className ?? "text-muted font-mono-data text-xs"} style={style}>{state}</span>;
}

export function ServerModName({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useServerModSubject();
  if (!mod) return null;

  return (
    <span data-el="serverMod.name" className={className ?? "truncate text-xs font-medium text-text"} style={style}>
      {mod.name ?? "Unknown mod"}
    </span>
  );
}

export function ServerModSize({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useServerModSubject();
  if (!mod || !mod.size_bytes) return null;

  return (
    <span data-el="serverMod.size" className={className ?? "font-mono-data text-xs text-muted mr-2"} style={style}>
      {formatBytes(mod.size_bytes)}
    </span>
  );
}
