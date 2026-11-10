import { describe, expect, it } from "vitest";
import { handlesOwnArrowKeys, isTextEntry, popupFocusMove, popupKeyTarget } from "./popup-keyboard";

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

/** The DOM reads these helpers make, over a plain object. */
const target = (
  { tagName = "BUTTON", role, tabbable = false, widget = null } = {} as {
    tagName?: string;
    role?: string;
    tabbable?: boolean;
    widget?: object | null;
  },
) => ({
  tagName,
  getAttribute: (name: string) => (name === "role" ? (role ?? null) : null),
  hasAttribute: (name: string) => name === "tabindex" && tabbable,
  closest: () => widget as null,
});

/** A popup element that contains whatever widget the target reports. */
const popupAround = (contains: boolean) => ({ contains: () => contains }) as unknown as Element;

describe("handlesOwnArrowKeys", () => {
  it.each([
    ["a tab strip or accordion inside the popup", target({ widget: {} }), popupAround(true), true],
    ["a resize handle", target({ role: "separator", tabbable: true }), popupAround(false), true],
    ["a plain option button", target(), popupAround(false), false],
    ["a widget that holds the popup, not one inside it", target({ widget: {} }), popupAround(false), false],
  ])("leaves the arrow keys to %s: %s", (_name, el, popup, expected) => {
    expect(handlesOwnArrowKeys(el, popup)).toBe(expected);
  });
});

describe("popupFocusMove", () => {
  it("moves focus over the popup's own options", () => {
    expect(popupFocusMove(target(), popupAround(false), "ArrowDown", 0, 3)).toBe(1);
  });

  it.each([
    ["a text box", target({ tagName: "INPUT" })],
    ["a control that handles the key itself", target({ widget: {} })],
  ])("leaves the key to %s", (_name, el) => {
    expect(popupFocusMove(el, popupAround(true), "ArrowDown", 0, 3)).toBeNull();
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
