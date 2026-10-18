import { describe, expect, it } from "vitest";
import { isTextEntry, popupKeyTarget } from "./popup-keyboard";

describe("isTextEntry", () => {
  it.each([
    [{ tagName: "INPUT", type: "text" }, true],
    [{ tagName: "TEXTAREA" }, true],
    [{ tagName: "DIV", isContentEditable: true }, true],
    [{ tagName: "INPUT", type: "checkbox" }, false],
    [{ tagName: "BUTTON" }, false],
  ])("keeps text entry out of popup key handling: %o is %s", (el, expected) => {
    expect(isTextEntry(el)).toBe(expected);
  });
});

describe("popupKeyTarget", () => {
  it.each([
    ["ArrowDown", -1, 3, 0],
    ["ArrowDown", 1, 3, 2],
    ["ArrowDown", 2, 3, 0],
    ["ArrowUp", -1, 3, 2],
    ["ArrowUp", 1, 3, 0],
    ["ArrowUp", 0, 3, 2],
    ["Home", 2, 3, 0],
    ["End", 0, 3, 2],
    ["Tab", 1, 3, null],
    ["ArrowDown", 0, 0, null],
  ])("%s from index %i of %i count goes to %s", (key, current, count, expected) => {
    expect(popupKeyTarget(key, current, count)).toBe(expected);
  });
});
