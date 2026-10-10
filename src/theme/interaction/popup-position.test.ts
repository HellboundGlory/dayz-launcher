import { describe, expect, it } from "vitest";
import { anchorGap, placePopup, type Align, type Placement, type Side } from "./popup-position";

const VIEWPORT = { width: 1000, height: 800 };

interface Case {
  name: string;
  trigger: { top: number; left: number; width: number; height: number };
  popup: { width: number; height: number };
  side: Side;
  align: Align;
  offset?: number;
  maxHeight?: number;
  margin?: number;
  expected: Placement;
}

const CASES: Case[] = [
  {
    name: "bottom/start with room sits directly under the trigger",
    trigger: { top: 100, left: 50, width: 120, height: 30 },
    popup: { width: 200, height: 100 },
    side: "bottom",
    align: "start",
    expected: { top: 134, left: 50, maxHeight: 658, side: "bottom" },
  },
  {
    name: "bottom with no room flips to top when the top has more room",
    trigger: { top: 700, left: 50, width: 120, height: 30 },
    popup: { width: 200, height: 100 },
    side: "bottom",
    align: "start",
    expected: { top: 596, left: 50, maxHeight: 688, side: "top" },
  },
  {
    name: "caps a tall popup at its max height so it stays below the trigger",
    trigger: { top: 300, left: 50, width: 120, height: 30 },
    popup: { width: 200, height: 500 },
    side: "bottom",
    align: "start",
    expected: { top: 334, left: 50, maxHeight: 458, side: "bottom" },
  },
  {
    name: "flips a tall popup using its capped height",
    trigger: { top: 700, left: 50, width: 120, height: 30 },
    popup: { width: 200, height: 500 },
    side: "bottom",
    align: "start",
    maxHeight: 100,
    expected: { top: 596, left: 50, maxHeight: 688, side: "top" },
  },
  {
    name: "clamps a tall popup by its capped height",
    trigger: { top: 0, left: 50, width: 120, height: 20 },
    popup: { width: 200, height: 2000 },
    side: "bottom",
    align: "start",
    maxHeight: 300,
    expected: { top: 24, left: 50, maxHeight: 768, side: "bottom" },
  },
  {
    name: "end align lines far edges up and shifts a wide popup inside the margin",
    trigger: { top: 100, left: 935, width: 60, height: 30 },
    popup: { width: 200, height: 100 },
    side: "bottom",
    align: "end",
    expected: { top: 134, left: 792, maxHeight: 658, side: "bottom" },
  },
  {
    name: "start align near the right edge shifts a wide popup back inside",
    trigger: { top: 100, left: 950, width: 40, height: 30 },
    popup: { width: 200, height: 100 },
    side: "bottom",
    align: "start",
    expected: { top: 134, left: 792, maxHeight: 658, side: "bottom" },
  },
  {
    name: "keeps a wider margin between the popup and the window edge",
    trigger: { top: 100, left: 10, width: 120, height: 30 },
    popup: { width: 200, height: 100 },
    side: "bottom",
    align: "start",
    margin: 20,
    expected: { top: 134, left: 20, maxHeight: 646, side: "bottom" },
  },
  {
    name: "center aligns on the trigger's centre",
    trigger: { top: 100, left: 500, width: 100, height: 30 },
    popup: { width: 200, height: 100 },
    side: "bottom",
    align: "center",
    expected: { top: 134, left: 450, maxHeight: 658, side: "bottom" },
  },
  {
    name: "center clamps a popup that would leave the window",
    trigger: { top: 100, left: 950, width: 100, height: 30 },
    popup: { width: 200, height: 100 },
    side: "bottom",
    align: "center",
    expected: { top: 134, left: 792, maxHeight: 658, side: "bottom" },
  },
  {
    name: "right side with no room flips left",
    trigger: { top: 100, left: 900, width: 40, height: 30 },
    popup: { width: 200, height: 100 },
    side: "right",
    align: "start",
    expected: { top: 100, left: 696, maxHeight: 784, side: "left" },
  },
];

describe("anchorGap", () => {
  const trigger = { top: 100, left: 50, width: 80, height: 30 };
  it.each([
    { side: "bottom", popup: { top: 138, left: 50, width: 80, height: 40 }, gap: 8 },
    { side: "top", popup: { top: 40, left: 50, width: 80, height: 56 }, gap: 4 },
    { side: "right", popup: { top: 100, left: 140, width: 60, height: 30 }, gap: 10 },
    { side: "left", popup: { top: 100, left: 0, width: 40, height: 30 }, gap: 10 },
  ] as const)("measures the $side gap from the trigger edge facing the popup", ({ side, popup, gap }) => {
    expect(anchorGap(side, trigger, popup)).toBe(gap);
  });
});

describe("placePopup", () => {
  it.each(CASES)("$name", (c) => {
    const result = placePopup({
      trigger: c.trigger,
      popup: c.popup,
      viewport: VIEWPORT,
      side: c.side,
      align: c.align,
      offset: c.offset ?? 4,
      maxHeight: c.maxHeight ?? 320,
      margin: c.margin,
    });
    expect(result).toEqual(c.expected);
  });
});

describe("placePopup in a short window", () => {
  it("shrinks a popup below its trigger instead of sliding it over the trigger", () => {
    const trigger = { top: 45, left: 448, width: 100, height: 26 };
    const placement = placePopup({
      trigger,
      popup: { width: 176, height: 190 },
      viewport: { width: 975, height: 220 },
      side: "bottom",
      align: "start",
      offset: 4,
      maxHeight: 256,
    });
    expect(placement.side).toBe("bottom");
    expect(placement.top).toBe(trigger.top + trigger.height + 4);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(220 - 8);
  });
});
