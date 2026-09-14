/** The composition tree's container props: literal Tailwind classes for a
 * `stack`, inline styles for a `grid` and every `gap`, and nothing at all for a
 * `box`. A synthesized `flex-${direction}` class ships with no CSS behind it,
 * so these pin the fixed lookups rather than the props' plumbing. */
import { describe, expect, it } from "vitest";
import { containerProps, type ContainerNode } from "./server-list";

const stack = (props: Record<string, unknown> = {}): ContainerNode =>
  ({ type: "stack", children: [], ...props }) as ContainerNode;

describe("containerProps", () => {
  it("defaults a stack to a row and adds only the enums it was given", () => {
    expect(containerProps(stack())).toEqual({ className: "flex flex-row" });
    expect(containerProps(stack({ direction: "column" }))).toEqual({
      className: "flex flex-col",
    });
    expect(
      containerProps(stack({ align: "center", justify: "space-between", wrap: true })),
    ).toEqual({ className: "flex flex-row flex-wrap items-center justify-between" });
  });

  it("carries gap as an inline style, never a class", () => {
    expect(containerProps(stack({ gap: "var(--space-md)" }))).toEqual({
      className: "flex flex-row",
      style: { gap: "var(--space-md)" },
    });
  });

  it("maps a grid to inline styles, ignoring wrap", () => {
    expect(
      containerProps({
        type: "grid",
        children: [],
        direction: "column",
        gap: "8px",
        align: "stretch",
        justify: "end",
        wrap: true,
      } as ContainerNode),
    ).toEqual({
      style: {
        display: "grid",
        gap: "8px",
        gridAutoFlow: "column",
        alignItems: "stretch",
        justifyContent: "end",
      },
    });
  });

  it("gives a grid no direction default and a bare display when it has no props", () => {
    expect(containerProps({ type: "grid", children: [] } as ContainerNode)).toEqual({
      style: { display: "grid" },
    });
  });

  it("gives a box no layout props at all — gap has no effect outside flex or grid", () => {
    expect(
      containerProps({
        type: "box",
        children: [],
        gap: "8px",
        direction: "column",
        align: "center",
        justify: "end",
        wrap: true,
      } as ContainerNode),
    ).toEqual({});
  });
});
