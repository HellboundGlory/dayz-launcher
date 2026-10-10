/** The pieces of the settings form that are not plain rendering: a number
 * field's write is debounced so a slider drag is not one disk write per pixel
 * (while a toggle is not debounced at all), its granularity is derived from
 * the schema's own span, and the colour text field only hands the store a
 * complete hex. Rendering the form needs a DOM this suite has no environment
 * for, so these are exercised directly. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isHexColor } from "@/theme/settings-schema";
import { scheduleCommit, stepFor, type CommitTimers } from "./ThemeSettingsForm";

describe("isHexColor", () => {
  it("accepts only a complete hex, so a partial one stays a draft", () => {
    for (const partial of ["", "#", "#f", "#ff", "#ff00", "#ff000"]) {
      expect(isHexColor(partial)).toBe(false);
    }
    expect(isHexColor("#ff0000")).toBe(true);
  });

  it("accepts a complete hex in either case", () => {
    expect(isHexColor("#AbCdEf")).toBe(true);
  });

  it("rejects a string the store would have to sanitise", () => {
    for (const value of ["#ff00001", "#ff000", "ff0000", "red"]) {
      expect(isHexColor(value)).toBe(false);
    }
  });
});

describe("stepFor", () => {
  it("keeps an integer-valued schema exact at step 1", () => {
    expect(stepFor(0, 360)).toBe(1);
    expect(stepFor(8, 72)).toBe(1);
  });

  it("gives a smaller span a finer step, so a fractional range can move", () => {
    // The browser default of 1 would snap 0..1 straight to the ends.
    expect(stepFor(0, 1)).toBe(0.01);
    expect(stepFor(0.5, 1.5)).toBe(0.01);
    expect(stepFor(0, 5)).toBe(0.1);
  });
});

describe("scheduleCommit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("holds a burst of changes to one write, carrying the latest value", () => {
    const timers: CommitTimers = {};
    const written: number[] = [];

    for (const hue of [10, 20, 30]) {
      scheduleCommit(timers, "accentHue", () => written.push(hue));
    }
    expect(written).toEqual([]);

    vi.advanceTimersByTime(400);
    expect(written).toEqual([30]);
  });

  it("re-arms only the field that changed, leaving another field's write intact", () => {
    const timers: CommitTimers = {};
    const written: number[] = [];

    scheduleCommit(timers, "accentHue", () => written.push(1));
    scheduleCommit(timers, "density", () => written.push(2));
    scheduleCommit(timers, "accentHue", () => written.push(3));

    vi.advanceTimersByTime(400);
    // The superseded hue write never fires; the re-armed one carries the newest
    // value, and the other field's pending write is untouched by either.
    expect(written).not.toContain(1);
    expect(written).toHaveLength(2);
    expect(written).toContain(3);
    expect(written).toContain(2);
  });

  it("does nothing before the delay elapses", () => {
    const timers: CommitTimers = {};
    const commit = vi.fn();

    scheduleCommit(timers, "accentHue", commit);
    vi.advanceTimersByTime(349);

    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
