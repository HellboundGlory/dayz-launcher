import { describe, expect, it } from "vitest";
import { isElementInLayout } from "./layout-query";
import type { LayoutFile } from "./renderer/types";

describe("isElementInLayout", () => {
  it.each<[string, LayoutFile, string, boolean]>([
    ["placed directly", { schemaVersion: 2, root: { element: "server.join" } }, "server.join", true],
    [
      "inside a surface's contains",
      { schemaVersion: 2, root: { surface: "surface.windowControls" } },
      "app.close",
      true,
    ],
    [
      "only in a variant root",
      { schemaVersion: 2, variants: [{ minWidth: 800, root: { element: "server.join" } }] },
      "server.join",
      true,
    ],
    ["only in a list row", { schemaVersion: 2, row: { element: "server.join" } }, "server.join", true],
    ["absent", { schemaVersion: 2, root: { element: "server.join" } }, "server.ping", false],
  ])("%s", (_name, layout, elementId, expected) => {
    expect(isElementInLayout(layout, elementId)).toBe(expected);
  });
});
