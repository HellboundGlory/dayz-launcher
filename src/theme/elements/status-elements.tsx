import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useElementContext } from "./context";

export function StatusSteam({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { steamConnected } = useElementContext();
  const display = (options?.display as string) ?? "dotLabel";
  const showDot = display === "dotLabel" || display === "dot";
  const showLabel = display === "dotLabel" || display === "label";
  const text = steamConnected ? "Steam connected" : "Steam not connected";
  const state = steamConnected ? "connected" : "disconnected";

  return (
    <div
      data-el="status.steam"
      data-state={state}
      title={display === "dot" ? text : undefined}
      aria-label={display === "dot" ? text : undefined}
      className={className ?? "flex items-center gap-[var(--t-space-inlineGap)]"}
      style={style}
    >
      {showDot && (
        <span
          data-part="dot"
          className={cn(
            "size-2 [border-radius:var(--t-radius-pill)] shrink-0",
            steamConnected ? "bg-success shadow-[0_0_6px_var(--success)]" : "bg-danger",
          )}
        />
      )}
      {showLabel && <span data-part="label" className="text-xs text-muted font-mono-data">{text}</span>}
    </div>
  );
}

export function StatusServerTotal({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { steamConnected, serverCounts } = useElementContext();
  if (!steamConnected) return null;

  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string | undefined) ?? "servers";

  return (
    <span data-el="status.serverTotal" className={className} style={style}>
      <span data-part="value">{serverCounts.total.toLocaleString()}</span>
      {showLabel && <span data-part="label">{" " + label}</span>}
    </span>
  );
}

export function StatusPopulated({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { steamConnected, serverCounts } = useElementContext();
  if (!steamConnected) return null;

  const showLabel = options?.showLabel !== false;
  const label = (options?.label as string | undefined) ?? "populated";

  return (
    <span data-el="status.populated" className={className} style={style}>
      <span data-part="value">{serverCounts.populated.toLocaleString()}</span>
      {showLabel && <span data-part="label">{" " + label}</span>}
    </span>
  );
}

export function StatusListSource({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { steamConnected, listSource } = useElementContext();
  if (!steamConnected || !listSource) return null;
  const label = (options?.label as string | undefined) ?? (listSource === "index" ? "index" : "Steam");
  const title =
    listSource === "index"
      ? "Served by Tetra's server index in one request"
      : "Asked Steam directly — the index was off, unreachable or stale";

  return (
    <span
      data-el="status.listSource"
      data-state={listSource}
      title={title}
      className={className}
      style={style}
    >
      via <span data-part="label">{label}</span>
    </span>
  );
}

export function StatusLastRefreshed({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { steamConnected, refreshedAt } = useElementContext();
  if (!steamConnected || !refreshedAt) return null;
  const label = typeof options?.label === "string" ? options.label : "Updated";

  return (
    <span data-el="status.lastRefreshed" className={className} style={style}>
      <span data-part="label">{label} </span>
      <span data-part="value">{refreshedAt}</span>
    </span>
  );
}

export function StatusActivity({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { discovering, refreshing, refreshedAt } = useElementContext();
  const state = discovering ? "discovering" : refreshing ? "refreshing" : "live";
  const dotClass =
    state === "discovering"
      ? "bg-warn animate-pulse"
      : state === "refreshing"
        ? "bg-accent animate-pulse"
        : "bg-success";
  const label =
    state === "discovering"
      ? "Discovering servers from Steam…"
      : state === "refreshing"
        ? "Probing server details…"
        : `Live · ${refreshedAt ?? "waiting"}`;

  return (
    <div
      data-el="status.activity"
      data-state={state}
      className={className ?? "flex items-center gap-[var(--t-space-inlineGap)]"}
      style={style}
    >
      <span
        data-part="dot"
        className={cn("size-2 [border-radius:var(--t-radius-pill)] shrink-0", dotClass)}
      />
      <span data-part="label" className="text-xs text-muted">
        {label}
      </span>
    </div>
  );
}
