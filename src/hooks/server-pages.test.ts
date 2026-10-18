import { describe, expect, it } from "vitest";
import { PageTracker } from "./server-pages";

const cases: { name: string; run: (t: PageTracker) => number[][]; expected: number[][] }[] = [
  {
    name: "a reload during a read re-reads the page once it lands",
    run: (t) => {
      t.want([0]);
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
      t.want([0]);
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
      t.want([0]);
      t.finished(t.started(0), true);
      return [t.next(), t.next()];
    },
    expected: [[], []],
  },
  {
    name: "a query change forgets the pages and ignores results from before it",
    run: (t) => {
      t.want([0, 1]);
      const old = t.started(0);
      t.reset();
      t.want([0, 1]);
      t.finished(old, true);
      const seen: number[][] = [t.next()];
      t.finished(t.started(0), true);
      seen.push(t.next());
      return seen;
    },
    expected: [[0, 1], [1]],
  },
];

describe("PageTracker", () => {
  it.each(cases)("$name", ({ run, expected }) => {
    expect(run(new PageTracker())).toEqual(expected);
  });
});
