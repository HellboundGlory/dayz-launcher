import { describe, expect, it } from "vitest";
import { parseDisplay } from "./element-utils";

describe("parseDisplay", () => {
  it.each([
    { name: "the default when no display is set", options: undefined, fallback: "iconLabel", showIcon: true, showLabel: true },
    { name: "an icon-only option", options: { display: "icon" }, fallback: "label", showIcon: true, showLabel: false },
    { name: "a label-only option", options: { display: "label" }, fallback: "iconLabel", showIcon: false, showLabel: true },
    { name: "a value no element accepts", options: { display: "dot" }, fallback: "iconLabel", showIcon: false, showLabel: false },
  ])("shows the parts for $name", ({ options, fallback, showIcon, showLabel }) => {
    expect(parseDisplay(options, fallback)).toEqual({ showIcon, showLabel });
  });
});
