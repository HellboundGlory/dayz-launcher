import { describe, expect, it } from "vitest";
import { noteForStep, startSteps, type StartStep } from "./start-steps";
import type { ActiveOp, OpPhase } from "@/stores/launch-store";

function op(phase: OpPhase, note: string | null = null): ActiveOp {
  return {
    addr: "1.2.3.4:27016",
    serverName: "Test Server",
    phase,
    note,
    cancel: { cancelled: false },
  };
}

const phases: { phase: OpPhase; states: StartStep["state"][] }[] = [
  { phase: "verifying", states: ["now", "todo", "todo", "todo"] },
  { phase: "subscribing", states: ["done", "now", "todo", "todo"] },
  { phase: "downloading", states: ["done", "now", "todo", "todo"] },
  { phase: "launching", states: ["done", "done", "now", "todo"] },
  { phase: "starting", states: ["done", "done", "now", "todo"] },
];

describe("startSteps", () => {
  it.each(phases)("marks the step $phase is on", ({ phase, states }) => {
    expect(startSteps(op(phase), false).map((step) => step.state)).toEqual(states);
  });

  it("uses the finished wording only behind the current step", () => {
    expect(startSteps(op("launching"), false).map((step) => step.label)).toEqual([
      "Mods checked",
      "Mods ready",
      "Starting DayZ…",
      "Joining the server",
    ]);
    expect(startSteps(op("verifying"), false).map((step) => step.label)).toEqual([
      "Checking the server's mods",
      "Getting mods from Steam",
      "Starting DayZ…",
      "Joining the server",
    ]);
  });

  it("shows the note on the download step only while it is current", () => {
    const downloading = startSteps(op("downloading", "3 LEFT · 1.2 GB / 4.0 GB"), false);
    expect(downloading[1].detail).toBe("3 LEFT · 1.2 GB / 4.0 GB");
    expect(downloading.filter((step) => step.detail !== "")).toHaveLength(1);

    expect(startSteps(op("launching", "3 LEFT · 1.2 GB / 4.0 GB"), false).map((s) => s.detail)).toEqual([
      "",
      "",
      "",
      "",
    ]);
  });

  it("offers the main menu instead of the server on a menu launch", () => {
    const last = (steps: StartStep[]) => steps[steps.length - 1].label;
    expect(last(startSteps(op("verifying"), true))).toBe("Opening the main menu");
    expect(last(startSteps(op("verifying"), false))).toBe("Joining the server");
  });
});

describe("noteForStep", () => {
  it("counts only the download step's note as progress", () => {
    expect(noteForStep(1, "3 LEFT · 1.2 GB / 4.0 GB")).toBe("3 LEFT · 1.2 GB / 4.0 GB");
    expect(noteForStep(0, "CHECKING STEAM…")).toBeNull();
    expect(noteForStep(2, "LAUNCHING…")).toBeNull();
  });
});
