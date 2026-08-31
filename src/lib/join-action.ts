// What the details panel's primary button says. Extracted from the
// component since getting this wrong is invisible until someone clicks.

export type JoinIcon = "download" | "play";

export interface JoinAction {
  label: string;
  icon: JoinIcon;
  /** Whether this press is expected to end in DayZ starting — read by the
      handler rather than re-derived, so label and behaviour can't disagree. */
  joins: boolean;
}

export interface JoinActionInput {
  /** Mods the server needs that are not subscribed at all. */
  missingCount: number;
  /** Mods subscribed but not yet usable — downloading, stale, or not installed. */
  arrivingCount: number;
  /** The `autoJoinAfterDownload` setting. */
  autoJoinAfterDownload: boolean;
}

// Names the outcome, never the mechanism — verification runs on every press
// unconditionally, so it has no business being in the label.
export function joinAction({
  missingCount,
  arrivingCount,
  autoJoinAfterDownload,
}: JoinActionInput): JoinAction {
  if (missingCount > 0) {
    return {
      label: autoJoinAfterDownload ? "SUBSCRIBE & JOIN" : "SUBSCRIBE & DOWNLOAD",
      icon: "download",
      joins: autoJoinAfterDownload,
    };
  }
  if (arrivingCount > 0) {
    return {
      label: autoJoinAfterDownload ? "DOWNLOAD & JOIN" : "FINISH DOWNLOADS",
      icon: "download",
      joins: autoJoinAfterDownload,
    };
  }
  // Everything the server asks for is present and current, as far as anything
  // knows before the check runs.
  return { label: "JOIN", icon: "play", joins: true };
}
