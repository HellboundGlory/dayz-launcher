export type JoinIcon = "download" | "play";

export interface JoinAction {
  label: string;
  icon: JoinIcon;
  /** Whether this press is expected to end in DayZ starting. */
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

/** What the join button says and does, given the selected server's mod readiness. */
export function joinAction({
  missingCount,
  arrivingCount,
  autoJoinAfterDownload,
}: JoinActionInput): JoinAction {
  if (missingCount > 0) {
    return {
      label: autoJoinAfterDownload ? "Subscribe & join" : "Subscribe & download",
      icon: "download",
      joins: autoJoinAfterDownload,
    };
  }
  if (arrivingCount > 0) {
    return {
      label: autoJoinAfterDownload ? "Download & join" : "Finish downloads",
      icon: "download",
      joins: autoJoinAfterDownload,
    };
  }
  return { label: "Join", icon: "play", joins: true };
}
