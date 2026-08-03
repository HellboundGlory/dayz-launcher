/**
 * What the details panel's primary button says.
 *
 * Extracted from the component because getting it wrong is invisible until
 * someone clicks — and this path has a history of exactly that. Two of the
 * three bugs ever recorded against the join button shipped because nothing that
 * runs in CI presses it.
 */

export type JoinIcon = "download" | "play";

export interface JoinAction {
  label: string;
  icon: JoinIcon;
  /**
   * Whether this press is expected to end in DayZ starting.
   *
   * Read by the handler rather than re-deriving the rule, so the label and the
   * behaviour cannot disagree — which is precisely how the bug behind all this
   * got in.
   */
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

/**
 * The button names the *outcome*, never the mechanism.
 *
 * Verification — re-reading the server's mod list and asking the Workshop
 * whether each mod has moved on — happens on every press, unconditionally. It
 * is housekeeping on the way to joining, not a thing the player asked for, and
 * it has no business being on a button. It used to be: the label read
 * `VERIFY & JOIN`, or `VERIFY` with auto-join off, which forced a two-press
 * model on the most ordinary action in the app just to keep the wording honest.
 * Naming the outcome instead deletes that whole apparatus.
 *
 * The two download labels stay, because they describe work the player can
 * already see in the mod list. `JOIN` is for when there is nothing to see.
 *
 * ## What `autoJoinAfterDownload` still governs
 *
 * Only the visible cases here. A press that turns out to need a download it
 * could not have predicted is handled in the *handler*, not the label — see
 * `handleVerifyAndJoin`. With the setting off it updates, stops, and says so,
 * and the label stays `JOIN` throughout so pressing again is the obvious move.
 */
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
