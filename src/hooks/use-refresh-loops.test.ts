import { describe, it, expect } from "vitest";
import type { Server } from "@/types/server";
import { refreshTargets } from "./use-refresh-loops";

const addr = (i: number) => `10.0.0.${i}`;
const list = (length: number, holes: number[] = []) =>
  Array.from({ length }, (_, i) =>
    holes.includes(i) ? undefined : ({ addr: addr(i) } as Server),
  );

describe("refreshTargets", () => {
  it.each([
    { name: "top of the list", range: { start: 0, end: 1 }, holes: [], cap: undefined, want: [0, 1, 2, 3] },
    { name: "middle of the list", range: { start: 8, end: 9 }, holes: [], cap: undefined, want: [6, 7, 8, 9, 10, 11] },
    { name: "end clamps to the last row", range: { start: 17, end: 19 }, holes: [], cap: undefined, want: [14, 15, 16, 17, 18, 19] },
    { name: "unloaded rows are skipped", range: { start: 4, end: 4 }, holes: [3], cap: undefined, want: [4, 5] },
    { name: "cap keeps the first rows in order", range: { start: 8, end: 9 }, holes: [], cap: 3, want: [6, 7, 8] },
  ])("$name", ({ range, holes, cap, want }) => {
    const servers = list(20, holes);
    expect(refreshTargets(servers, range, cap).map((s) => s.addr)).toEqual(want.map(addr));
  });
});
