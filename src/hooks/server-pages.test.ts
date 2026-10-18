import { describe, expect, it } from "vitest";
import { PageTracker } from "./server-pages";

const view = { first: 0, last: 0 };

const cases: { name: string; run: (t: PageTracker) => number[][]; expected: number[][] }[] = [
  {
    name: "a reload during a read re-reads the page once it lands",
    run: (t) => {
      t.want([0], view);
      const read = t.started(0);
      t.invalidate();
      const seen: number[][] = [t.next()];
      t.finished(read, true);
      seen.push(t.next());
      t.finished(t.started(0), true);
      seen.push(t.next());
      return seen;
    },
    expected: [[], [0], []],
  },
  {
    name: "a failed read waits for a retry",
    run: (t) => {
      t.want([0], view);
      t.finished(t.started(0), false);
      const seen: number[][] = [t.next()];
      t.retry(0);
      seen.push(t.next());
      t.finished(t.started(0), true);
      seen.push(t.next());
      return seen;
    },
    expected: [[], [0], []],
  },
  {
    name: "a short page is loaded and not read again",
    run: (t) => {
      t.want([0], view);
      t.finished(t.started(0), true);
      return [t.next(), t.next()];
    },
    expected: [[], []],
  },
  {
    name: "a query change forgets the pages and ignores results from before it",
    run: (t) => {
      t.want([0, 1], view);
      const old = t.started(0);
      t.reset();
      t.want([0, 1], view);
      t.finished(old, true);
      const seen: number[][] = [t.next()];
      t.finished(t.started(0), true);
      seen.push(t.next());
      return seen;
    },
    expected: [[0, 1], [1]],
  },
  {
    name: "with two reads in flight, the next read is the wanted page nearest the new range",
    run: (t) => {
      t.want([0, 1, 2, 3, 4, 5, 6, 7], view);
      const reads = t.next().map((p) => t.started(p));
      t.want([0, 1, 2, 3, 4, 7], { first: 6, last: 6 });
      const seen: number[][] = [t.next()];
      t.finished(reads[0], true);
      seen.push(t.next());
      return seen;
    },
    expected: [[], [7]],
  },
];

describe("PageTracker", () => {
  it.each(cases)("$name", ({ run, expected }) => {
    expect(run(new PageTracker())).toEqual(expected);
  });
});
