import { describe, expect, it } from "vitest";
import { containerProps, effectiveModState } from "./mods-tab.tsx";
import type { ResolvedNode } from "@/theme/component-tree";

type Container = Extract<ResolvedNode, { type: "stack" | "box" | "grid" }>;
const container = (node: Omit<Container, "children">): Container => ({ ...node, children: [] });

describe("effectiveModState", () => {
  it("defaults to rowState when liveState is absent", () => {
    expect(effectiveModState("ready", undefined)).toBe("ready");
    expect(effectiveModState("needs_update", undefined)).toBe("needs_update");
  });

  it("prioritizes downloading over all states", () => {
    expect(effectiveModState("ready", "downloading")).toBe("downloading");
    expect(effectiveModState("needs_update", "downloading")).toBe("downloading");
  });

  it("never allows a cheap poll's 'ready' to downgrade 'needs_update'", () => {
    expect(effectiveModState("needs_update", "ready")).toBe("needs_update");
  });

  it("reflects uninstalled or unsubscribed live states even if row was needs_update", () => {
    expect(effectiveModState("needs_update", "not_installed")).toBe("not_installed");
    expect(effectiveModState("needs_update", "not_subscribed")).toBe("not_subscribed");
  });

  it("reflects liveState when row was ready", () => {
    expect(effectiveModState("ready", "ready")).toBe("ready");
    expect(effectiveModState("ready", "not_installed")).toBe("not_installed");
    expect(effectiveModState("ready", "needs_update")).toBe("needs_update");
  });
});

describe("containerProps", () => {
  it("lays a stack out as a flex row by default", () => {
    expect(containerProps(container({ type: "stack" })).className).toBe("flex flex-row");
  });

  it("maps a stack's enums to literal flex classes, never a built name", () => {
    const { className } = containerProps(
      container({
        type: "stack",
        direction: "column",
        align: "stretch",
        justify: "space-between",
        wrap: true,
      }),
    );
    expect(className?.split(" ")).toEqual([
      "flex",
      "flex-col",
      "flex-wrap",
      "items-stretch",
      "justify-between",
    ]);
  });

  it("applies a stack's gap as an inline style, not a class", () => {
    const { className, style } = containerProps(container({ type: "stack", gap: "var(--space-xs)" }));
    expect(style).toEqual({ gap: "var(--space-xs)" });
    expect(className).not.toContain("gap");
  });

  it("lays a grid out with inline styles and ignores wrap", () => {
    const { className, style } = containerProps(
      container({
        type: "grid",
        gap: "6px",
        direction: "column",
        align: "end",
        justify: "center",
        wrap: true,
      }),
    );
    expect(className).toBeUndefined();
    expect(style).toEqual({
      display: "grid",
      gap: "6px",
      gridAutoFlow: "column",
      alignItems: "end",
      justifyContent: "center",
    });
  });

  it("gives a box no layout of its own", () => {
    expect(
      containerProps(
        container({ type: "box", gap: "6px", direction: "column", align: "end", wrap: true }),
      ),
    ).toEqual({});
  });
});
