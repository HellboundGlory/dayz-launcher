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

  return (
    <span data-el="status.serverTotal" className={className} style={style}>
      <span data-part="value">{serverCounts.total.toLocaleString()}</span>
      {showLabel && <span data-part="label"> servers</span>}
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

  return (
    <span data-el="status.populated" className={className} style={style}>
      <span data-part="value">{serverCounts.populated.toLocaleString()}</span>
      {showLabel && <span data-part="label"> populated</span>}
    </span>
  );
}

export function StatusListSource({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { steamConnected, listSource } = useElementContext();
  if (!steamConnected || !listSource) return null;

  return (
    <span
      data-el="status.listSource"
      data-state={listSource}
      className={className}
      style={style}
    >
      <span data-part="label">{listSource === "index" ? "Indexed" : "Steam Direct"}</span>
    </span>
  );
}

export function StatusLastRefreshed({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const { steamConnected, refreshedAt } = useElementContext();
  if (!steamConnected || !refreshedAt) return null;

  return (
    <span data-el="status.lastRefreshed" className={className} style={style}>
      <span data-part="label">Updated </span>
      <span data-part="value">{refreshedAt}</span>
    </span>
  );
}
