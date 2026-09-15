import { describe, expect, it } from "vitest";
import { isCompositionCapped } from "./use-component-composition";
import { SLOTS } from "./slots";

describe("isCompositionCapped", () => {
  it("caps every slot with compositionCeiling: \"advanced\"", () => {
    for (const slot of SLOTS.filter((s) => s.compositionCeiling === "advanced")) {
      expect(isCompositionCapped(slot.id)).toBe(true);
    }
  });

  it("does not cap a slot with no compositionCeiling", () => {
    for (const slot of SLOTS.filter((s) => s.compositionCeiling === undefined)) {
      expect(isCompositionCapped(slot.id)).toBe(false);
    }
  });

  it("does not cap an unknown slot id", () => {
    expect(isCompositionCapped("not.a.real.slot")).toBe(false);
  });
});
