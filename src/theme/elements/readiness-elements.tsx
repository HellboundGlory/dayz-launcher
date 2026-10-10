import type { CSSProperties } from "react";
import type { ModReadinessEntry, Server, ServerModReadiness } from "@/types/server";
import { formatBytes } from "@/lib/utils";
import { useServerStore } from "@/stores/server-store";
import { isOutstandingMod, useSelectionReadiness } from "./use-selection-readiness";
import { useServerSubject } from "./server-elements";
import { states } from "./element-utils";

export type ReadinessState =
  | "checking"
  | "ready"
  | "needsDownload"
  | "needsUpdate"
  | "downloading"
  | "unchecked"
  | "noMods"
  | "stale";

export interface ReadinessView {
  /** What the theme sees on `data-state` — `stale` wins over the content state, per SPEC §11.2. */
  dataState: ReadinessState;
  label: string;
  sizeBytes: number | null;
  /** True when any summed mod is only an update estimate (ADR-0021: "up to {size}"). */
  sizeIsUpperBound: boolean;
}

function sumOutstanding(mods: ModReadinessEntry[]): { bytes: number | null; upperBound: boolean } {
  let bytes = 0;
  let found = false;
  let upperBound = false;

  for (const mod of mods) {
    if (!isOutstandingMod(mod)) continue;
    found = true;
    if (mod.size_is_upper_bound) upperBound = true;
    const modBytes = mod.state === "downloading" ? (mod.total_bytes ?? mod.size_bytes) : mod.size_bytes;
    if (modBytes !== null) bytes += modBytes;
  }

  return { bytes: found ? bytes : null, upperBound };
}

export function computeReadinessView(
  readiness: ServerModReadiness | null,
  loading: boolean,
): ReadinessView {
  if (loading) {
    return { dataState: "checking", label: "Checking mods…", sizeBytes: null, sizeIsUpperBound: false };
  }

  if (!readiness) {
    return { dataState: "unchecked", label: "Mods not checked", sizeBytes: null, sizeIsUpperBound: false };
  }

  const { mods, stale } = readiness;
  const downloading = mods.filter((m) => m.state === "downloading");
  const needsDownload = mods.filter((m) => m.state === "not_installed" || m.state === "not_subscribed");
  const needsUpdate = mods.filter((m) => m.state === "needs_update");

  let contentState: Exclude<ReadinessState, "checking" | "stale">;
  let label: string;

  if (downloading.length > 0) {
    contentState = "downloading";
    const done = downloading.reduce((sum, m) => sum + (m.downloaded_bytes ?? 0), 0);
    const total = downloading.reduce((sum, m) => sum + (m.total_bytes ?? m.size_bytes ?? 0), 0);
    label = `Downloading ${formatBytes(done)} of ${formatBytes(total)}`;
  } else if (needsDownload.length > 0) {
    contentState = "needsDownload";
    label = `${needsDownload.length} to download`;
  } else if (needsUpdate.length > 0) {
    contentState = "needsUpdate";
    label = `${needsUpdate.length} to update`;
  } else if (mods.length === 0) {
    contentState = "noMods";
    label = "No mods declared";
  } else {
    contentState = "ready";
    label = "All mods ready";
  }

  const { bytes, upperBound } = sumOutstanding(mods);
  return { dataState: stale ? "stale" : contentState, label, sizeBytes: bytes, sizeIsUpperBound: upperBound };
}

type ReadinessProps = {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
};

export function ServerReadiness(props: ReadinessProps) {
  return props.options?.basis === "declared" ? <DeclaredReadiness {...props} /> : <FetchedReadiness {...props} />;
}

/** The legacy strip's wording, from the server's declared mods, not fetched readiness. */
function declaredReadinessView(server: Server, pending: boolean): { dataState: ReadinessState; label: string } {
  if (pending) return { dataState: "needsUpdate", label: "Mod update pending — verify before join" };
  if (server.mod_count === null) {
    return server.modded
      ? { dataState: "unchecked", label: "Mods not checked — verify before join" }
      : { dataState: "noMods", label: "No mods declared" };
  }
  if (server.mod_count === 0) return { dataState: "noMods", label: "No mods declared" };
  const n = server.mod_count;
  return { dataState: "ready", label: `${n} mod${n === 1 ? "" : "s"} declared` };
}

function DeclaredReadiness({ options, className, style }: ReadinessProps) {
  const server = useServerSubject();
  const pending = useServerStore((s) => !!server && !!s.modPending[server.addr]);
  if (!server) return null;
  const { dataState, label } = declaredReadinessView(server, pending);
  return (
    <ReadinessLine
      dataState={dataState}
      label={label}
      sizeText={null}
      offline={!server.online}
      options={options}
      className={className}
      style={style}
    />
  );
}

function FetchedReadiness({ options, className, style }: ReadinessProps) {
  const server = useServerSubject();
  const { readiness, loading } = useSelectionReadiness(server);
  const view = computeReadinessView(readiness, loading);

  const sizeText =
    view.sizeBytes !== null
      ? `${view.sizeIsUpperBound ? "up to " : ""}${formatBytes(view.sizeBytes)}`
      : null;

  return (
    <ReadinessLine
      dataState={view.dataState}
      label={view.label}
      sizeText={sizeText}
      offline={server !== null && !server.online}
      options={options}
      className={className}
      style={style}
    />
  );
}

function ReadinessLine({
  dataState,
  label,
  sizeText,
  offline,
  options,
  className,
  style,
}: ReadinessProps & {
  dataState: ReadinessState;
  label: string;
  sizeText: string | null;
  offline: boolean;
}) {
  const showDot = options?.showDot !== false;
  const showSize = options?.showSize !== false;
  const labelOverride = options?.label as string | undefined;

  return (
    <div data-el="server.readiness" data-state={states(dataState, offline && "offline")} className={className} style={style}>
      {showDot && <span data-part="dot" />}
      <span data-part="label">{labelOverride ?? label}</span>
      {showSize && sizeText && <span data-part="size">{sizeText}</span>}
    </div>
  );
}

export function ServerDownloadSize({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const server = useServerSubject();
  const { readiness } = useSelectionReadiness(server);
  if (!server?.modded || !readiness) return null;

  const outstanding = readiness.mods.filter(isOutstandingMod);
  const bytes = outstanding.reduce((sum, m) => sum + (m.size_bytes ?? 0), 0);
  const upperBound = outstanding.some((m) => m.size_is_upper_bound);
  const count = readiness.mods.length;
  const dataState = outstanding.length === 0 ? "none" : upperBound ? "upperBound" : undefined;

  return (
    <div data-el="server.downloadSize" data-state={states(dataState, !server.online && "offline")} className={className} style={style}>
      <span data-part="count">{`${count} mod${count === 1 ? "" : "s"}`}</span>
      <span data-part="value">
        Download size: {upperBound && <span data-part="qualifier">up to </span>}
        {formatBytes(bytes, 1)}
      </span>
    </div>
  );
}
