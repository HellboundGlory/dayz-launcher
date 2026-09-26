import type { CSSProperties } from "react";
import type { ModReadinessEntry, ServerModReadiness } from "@/types/server";
import { formatBytes } from "@/lib/utils";
import { useSelectionReadiness } from "./use-selection-readiness";

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

const OUTSTANDING_STATES = new Set<ModReadinessEntry["state"]>([
  "not_installed",
  "not_subscribed",
  "needs_update",
  "downloading",
]);

function sumOutstanding(mods: ModReadinessEntry[]): { bytes: number | null; upperBound: boolean } {
  let bytes = 0;
  let found = false;
  let upperBound = false;

  for (const mod of mods) {
    if (!OUTSTANDING_STATES.has(mod.state)) continue;
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

export function ServerReadiness({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { readiness, loading } = useSelectionReadiness();
  const view = computeReadinessView(readiness, loading);

  const showDot = options?.showDot !== false;
  const showSize = options?.showSize !== false;
  const labelOverride = options?.label as string | undefined;

  const sizeText =
    view.sizeBytes !== null
      ? `${view.sizeIsUpperBound ? "up to " : ""}${formatBytes(view.sizeBytes)}`
      : null;

  return (
    <div data-el="server.readiness" data-state={view.dataState} className={className} style={style}>
      {showDot && <span data-part="dot" />}
      <span data-part="label">{labelOverride ?? view.label}</span>
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
  const { readiness, loading } = useSelectionReadiness();
  const view = computeReadinessView(readiness, loading);

  let dataState: "checking" | "none" | "upperBound" | undefined;
  let qualifier: string | null = null;
  let value: string;

  if (view.dataState === "checking") {
    dataState = "checking";
    value = "Checking…";
  } else if (view.sizeBytes === null) {
    dataState = "none";
    value = "Nothing to download";
  } else if (view.sizeIsUpperBound) {
    dataState = "upperBound";
    qualifier = "up to";
    value = formatBytes(view.sizeBytes);
  } else {
    value = formatBytes(view.sizeBytes);
  }

  return (
    <div data-el="server.downloadSize" data-state={dataState} className={className} style={style}>
      {qualifier && <span data-part="qualifier">{qualifier}</span>}
      <span data-part="value">{value}</span>
    </div>
  );
}
