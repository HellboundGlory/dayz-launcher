/** The popover's list arithmetic: which row a pointer's y lands on, the order a
 * drag commits, and where a hidden row is listed. Rendering this needs a DOM
 * the suite has no environment for, so the decisions are exercised directly. */
import { describe, expect, it } from "vitest";
import { dropIndexFor, moveItem, orderWithHidden } from "./layout-drag";

/** Three 20px rows starting at y=100, as `getBoundingClientRect` would report. */
const ROWS = [
  { top: 100, bottom: 120 },
  { top: 120, bottom: 140 },
  { top: 140, bottom: 160 },
];

describe("dropIndexFor", () => {
  it("takes the first row whose bottom edge is still below the pointer", () => {
    expect(dropIndexFor(100, ROWS)).toBe(0);
    expect(dropIndexFor(119, ROWS)).toBe(0);
    expect(dropIndexFor(121, ROWS)).toBe(1);
    expect(dropIndexFor(139, ROWS)).toBe(1);
    expect(dropIndexFor(141, ROWS)).toBe(2);
  });

  it("lands on the last row once the pointer is past them all", () => {
    expect(dropIndexFor(900, ROWS)).toBe(2);
  });

  it("handles an empty list and a pointer above it", () => {
    expect(dropIndexFor(50, [])).toBe(0);
    expect(dropIndexFor(0, ROWS)).toBe(0);
  });
});

describe("moveItem", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a row down to the index the pointer is over", () => {
    expect(moveItem(ids, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a row up, shifting the rest along", () => {
    expect(moveItem(ids, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when the row is dropped where it started, and never mutates", () => {
    expect(moveItem(ids, 2, 2)).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});

describe("orderWithHidden", () => {
  const registry = ["a", "b", "c", "d"];

  it("puts a hidden child back at its registry position", () => {
    expect(orderWithHidden(["a", "d"], ["b"], registry)).toEqual(["a", "b", "d"]);
    expect(orderWithHidden(["a", "c"], ["b"], registry)).toEqual(["a", "b", "c"]);
  });

  it("keeps a hidden child last when it has no registry position", () => {
    expect(orderWithHidden(["a"], ["gone"], registry)).toEqual(["a", "gone"]);
  });

  it("returns the visible order unchanged when nothing is hidden", () => {
    expect(orderWithHidden(["d", "a"], [], registry)).toEqual(["d", "a"]);
  });
});
