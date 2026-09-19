import type { CSSProperties } from "react";
import { formatBytes } from "@/lib/utils";
import { useElementContext } from "./context";

interface ModData {
  id?: string | number;
  name?: string;
  status?: string;
  size?: number;
  updated?: string;
  author?: string;
  subscribed?: boolean;
}

function useModSubject(): ModData | null {
  const { subjectContext, selectedMod } = useElementContext();
  if (subjectContext?.kind === "mod") {
    return subjectContext.data as ModData;
  }
  return selectedMod as ModData;
}

export function ModName({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;
  return (
    <span data-el="mod.name" className={className ?? "truncate"} style={style}>
      {mod.name ?? "Unknown mod"}
    </span>
  );
}

export function ModStatus({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;
  return (
    <span data-el="mod.status" className={className} style={style}>
      {mod.status ?? "Ready"}
    </span>
  );
}

export function ModSize({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod || mod.size === undefined) return null;
  return (
    <span data-el="mod.size" className={className ?? "font-mono-data"} style={style}>
      {formatBytes(mod.size)}
    </span>
  );
}

export function ModUpdated({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod || !mod.updated) return null;
  return (
    <span data-el="mod.updated" className={className ?? "text-muted"} style={style}>
      {mod.updated}
    </span>
  );
}

export function ModAuthor({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod || !mod.author) return null;
  return (
    <span data-el="mod.author" className={className ?? "text-muted"} style={style}>
      {mod.author}
    </span>
  );
}

export function ModSubscribed({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod || !mod.subscribed) return null;
  return (
    <span data-el="mod.subscribed" className={className ?? "text-muted"} style={style}>
      Subscribed
    </span>
  );
}

export function ModActions({ className, style }: { className?: string; style?: CSSProperties }) {
  const mod = useModSubject();
  if (!mod) return null;
  return (
    <div data-el="mod.actions" className={className} style={style}>
      {/* Mod action buttons */}
    </div>
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

