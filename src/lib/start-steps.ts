import type { ActiveOp, OpPhase } from "@/stores/launch-store";

export interface StartStep {
  /** What the step reads while it is the current one, or the plain name once done. */
  label: string;
  state: "done" | "now" | "todo";
  /** Live detail for the current step — the op's own note, empty everywhere else. */
  detail: string;
}

/** Which step each phase belongs to, in the order a join runs them. */
const STEP_OF_PHASE: Record<OpPhase, number> = {
  verifying: 0,
  subscribing: 1,
  downloading: 1,
  launching: 2,
  starting: 2,
};

/** The step whose note moves with its own progress, so a change restarts the slow count there. */
const DOWNLOAD_STEP = 1;

const LABELS: { now: string; done: string | null }[] = [
  { now: "Checking the server's mods", done: "Mods checked" },
  { now: "Getting mods from Steam", done: "Mods ready" },
  { now: "Starting DayZ…", done: "DayZ started" },
  // The window closes once DayZ appears, so this step never reaches "done".
  { now: "Joining the server", done: null },
];

const MENU_LABEL = "Opening the main menu";

/** The join as a list of steps: everything before the current one done, everything after it to come. */
export function startSteps(op: ActiveOp, toMenu: boolean): StartStep[] {
  const current = STEP_OF_PHASE[op.phase];
  return LABELS.map((step, index) => {
    let state: StartStep["state"] = "todo";
    if (index < current) state = "done";
    else if (index === current) state = "now";

    let label = state === "done" ? (step.done ?? step.now) : step.now;
    if (toMenu && index === LABELS.length - 1) label = MENU_LABEL;

    const detail = index === DOWNLOAD_STEP && state === "now" ? (op.note ?? "") : "";
    return { label, state, detail };
  });
}

/**
 * The note that should restart the current step's clock. Only the download
 * step's note tracks progress; elsewhere it is just the phase wording.
 */
export function noteForStep(index: number, note: string | null): string | null {
  return index === DOWNLOAD_STEP ? note : null;
}
