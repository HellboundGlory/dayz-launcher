import { describe, expect, it } from "vitest";
import { toastTop } from "./toast-placement";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("toastTop", () => {
  const column = { left: 266, right: 636 };

  it.each([
    ["no controls", [], 48],
    ["controls left of the column", [box(10, 40, 200, 30)], 48],
    ["a control under the column", [box(400, 40, 120, 30)], 78],
    ["two wrapped toolbar rows", [box(400, 40, 120, 30), box(80, 92, 300, 30)], 130],
    ["a control below the band", [box(400, 300, 120, 30)], 48],
  ])("%s", (_name, controls, expected) => {
    expect(toastTop(controls, column)).toBe(expected);
  });
});
