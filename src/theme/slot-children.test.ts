/** The two rules every slot-rendering component depends on: resolved order is
 * authoritative (including against the caller's own group order), and required
 * content survives a hidden entry the resolver could not have produced. */
import { describe, expect, it } from "vitest";
import { slotChildrenToRender } from "./slot-children";
import type { ResolvedSlotLayout } from "./layout-store";

const slot = (children: string[], hidden: string[] = []): ResolvedSlotLayout => ({
  children,
  hidden,
  params: {},
});

describe("slotChildrenToRender", () => {
  it("keeps resolved order, not the group's own order", () => {
    expect(slotChildrenToRender(slot(["b", "a", "c"]), [], ["a", "b", "c"])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("narrows to the group, dropping children that render in another one", () => {
    expect(slotChildrenToRender(slot(["a", "b", "c"]), [], ["c", "a"])).toEqual(["a", "c"]);
  });

  it("drops a hidden optional child", () => {
    expect(slotChildrenToRender(slot(["a", "b"], ["a"]), [], ["a", "b"])).toEqual(["b"]);
  });

  it("keeps a hidden required child, at its resolved position", () => {
    expect(slotChildrenToRender(slot(["a", "b", "c"], ["b"]), ["b"])).toEqual(["a", "b", "c"]);
  });

  it("appends a required child the resolved children left out", () => {
    expect(slotChildrenToRender(slot(["a"]), ["b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("ignores a required child that renders in another group", () => {
    expect(slotChildrenToRender(slot(["a"]), ["z"], ["a", "b"])).toEqual(["a"]);
  });
});
