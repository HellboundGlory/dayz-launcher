/** The component-tree resolver against a slot registry slice: a bad node, prop
 * or `ref` costs that node only, while a root the resolver cannot read costs
 * the whole tree — and required children always survive either way. */
import { describe, expect, it } from "vitest";
import { resolveComponentTree, type ResolvedNode } from "./component-tree";
import { SLOTS } from "./slots";

const childrenOf = (slotId: string) => {
  const slot = SLOTS.find((candidate) => candidate.id === slotId);
  if (!slot) throw new Error(`no slot '${slotId}' in SLOTS`);
  return slot.children;
};

/** Children of a resolved tree's root. Every case below composes a container
 * root, so a null tree or a core leaf here is a test bug, not a case. */
const rootChildren = (node: ResolvedNode | null) => {
  if (node === null || node.type === "core") throw new Error("expected a resolved container root");
  return node.children;
};

const tree = (root: unknown, slot = "server.row") => ({ slot, root });

describe("resolveComponentTree", () => {
  it("resolves a nested tree of containers and core leaves with no issues", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({
        type: "stack",
        direction: "row",
        gap: "sm",
        align: "center",
        justify: "space-between",
        wrap: true,
        children: [
          { type: "core", ref: "name", grow: true },
          {
            type: "stack",
            direction: "row",
            gap: "var(--space-xs)",
            children: [
              { type: "core", ref: "pingBadge" },
              {
                type: "grid",
                align: "stretch",
                children: [{ type: "core", ref: "playerCount" }],
              },
            ],
          },
          { type: "box", justify: "end", children: [{ type: "core", ref: "modStatusBadge" }] },
        ],
      }),
      childrenOf("server.row"),
    );

    expect(issues).toEqual([]);
    expect(resolved).toEqual({
      type: "stack",
      direction: "row",
      gap: "sm",
      align: "center",
      justify: "space-between",
      wrap: true,
      children: [
        { type: "core", ref: "name", grow: true },
        {
          type: "stack",
          direction: "row",
          gap: "var(--space-xs)",
          children: [
            { type: "core", ref: "pingBadge" },
            {
              type: "grid",
              align: "stretch",
              children: [{ type: "core", ref: "playerCount" }],
            },
          ],
        },
        { type: "box", justify: "end", children: [{ type: "core", ref: "modStatusBadge" }] },
      ],
    });
  });

  it("drops an unrecognised node type with an issue but resolves the rest", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({
        type: "stack",
        children: [
          { type: "iframe", ref: "name" },
          { type: "core", ref: "name" },
          { type: "stack", children: [{ type: "script", src: "evil.js" }] },
        ],
      }),
      childrenOf("server.row"),
    );

    expect(resolved).toEqual({
      type: "stack",
      children: [
        { type: "core", ref: "name" },
        { type: "stack", children: [] },
        { type: "core", ref: "modStatusBadge" },
      ],
    });
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message: "node type 'iframe' is not one of stack, box, grid, core — node dropped",
      },
      {
        slotId: "server.row",
        message: "node type 'script' is not one of stack, box, grid, core — node dropped",
      },
    ]);
  });

  it("drops a core leaf whose ref is not a child of this slot, with an issue", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({
        type: "box",
        children: [
          { type: "core", ref: "ghostLabel" },
          { type: "core", ref: "modStatusBadge" },
          // A child id that exists, but in a different slot.
          { type: "core", ref: "joinAction" },
        ],
      }),
      childrenOf("server.row"),
    );

    expect(rootChildren(resolved)).toEqual([
      { type: "core", ref: "modStatusBadge" },
      { type: "core", ref: "name" },
    ]);
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message: "core ref 'ghostLabel' is not a child of slot 'server.row' — leaf dropped",
      },
      {
        slotId: "server.row",
        message: "core ref 'joinAction' is not a child of slot 'server.row' — leaf dropped",
      },
    ]);
  });
});

describe("resolveComponentTree container props", () => {
  // A registry slice with no required children, so these assertions see only
  // the prop under test rather than the auto-append rule's output.
  const optional = [{ id: "name", required: false, since: "1.0" }];

  it("keeps literal lengths, var() references and plain keywords for gap", () => {
    for (const value of ["12rem", "0.5rem", "240px", "78.5vh", "var(--space-md)", "compact"]) {
      const { tree: resolved, issues } = resolveComponentTree(
        "server.row",
        tree({ type: "stack", gap: value, children: [] }),
        optional,
      );
      expect(issues).toEqual([]);
      expect(resolved).toEqual({ type: "stack", gap: value, children: [] });
    }
  });

  it("rejects a Tailwind-class-shaped gap with an issue and drops the prop", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", gap: "gap-2 px-4", children: [{ type: "core", ref: "name" }] }),
      optional,
    );

    expect(resolved).toEqual({ type: "stack", children: [{ type: "core", ref: "name" }] });
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message:
          "'gap' is not a literal value ('gap-2 px-4') — Tailwind class names are never valid here, only CSS lengths, var() references, or plain keywords",
      },
    ]);
  });

  it.each([
    ["a spaced class list", "flex items-center"],
    ["a number", 4],
    ["a boolean", true],
    ["an object", { px: 4 }],
    ["null", null],
  ])("drops %s as a gap value", (_label, value) => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", gap: value, children: [] }),
      optional,
    );

    expect(resolved).toEqual({ type: "stack", children: [] });
    expect(issues).toHaveLength(1);
    expect(issues[0].slotId).toBe("server.row");
    expect(issues[0].message).toContain("'gap' is not a literal value");
  });

  it.each([
    ["direction", "diagonal", ["row", "column"]],
    ["align", "middle", ["start", "center", "end", "stretch"]],
    ["justify", "around", ["start", "center", "end", "space-between"]],
  ])("rejects %s outside its fixed enum", (prop, value, allowed) => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", [prop]: value, children: [] }),
      optional,
    );

    expect(resolved).toEqual({ type: "stack", children: [] });
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message: `'${prop}' must be one of ${allowed.join(", ")} ('${value}') — prop dropped`,
      },
    ]);
  });

  it("rejects a non-boolean wrap, keeping the node", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", wrap: "true", children: [{ type: "core", ref: "name" }] }),
      optional,
    );

    expect(resolved).toEqual({ type: "stack", children: [{ type: "core", ref: "name" }] });
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message: "'wrap' must be a boolean ('true') — prop dropped",
      },
    ]);
  });

  it("rejects a non-boolean grow on a core leaf, keeping the leaf", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", children: [{ type: "core", ref: "name", grow: 1 }] }),
      optional,
    );

    expect(resolved).toEqual({
      type: "stack",
      children: [{ type: "core", ref: "name" }],
    });
    expect(issues).toEqual([
      { slotId: "server.row", message: "'grow' must be a boolean ('1') — prop dropped" },
    ]);
  });

  it.each([
    [{ type: "stack", children: {} }],
    [{ type: "stack", children: "name" }],
    [{ type: "stack", children: null }],
  ])("treats a container whose children is %o as empty, without issues", (root) => {
    const { tree: resolved, issues } = resolveComponentTree("server.row", tree(root), optional);

    expect(resolved).toEqual({ type: "stack", children: [] });
    expect(issues).toEqual([]);
  });

  it("drops a non-object child node with an issue", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", children: [null, "name"] }),
      optional,
    );

    expect(resolved).toEqual({ type: "stack", children: [] });
    expect(issues).toEqual([
      { slotId: "server.row", message: "node is not an object ('null') — node dropped" },
      { slotId: "server.row", message: "node is not an object ('name') — node dropped" },
    ]);
  });
});

describe("resolveComponentTree required children", () => {
  it("appends a missing required child under the root, keeping registry order", () => {
    // server.row requires modStatusBadge and name; the theme placed neither.
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", children: [{ type: "core", ref: "pingBadge" }] }),
      childrenOf("server.row"),
    );

    expect(rootChildren(resolved)).toEqual([
      { type: "core", ref: "pingBadge" },
      { type: "core", ref: "modStatusBadge" },
      { type: "core", ref: "name" },
    ]);
    expect(issues).toEqual([]);
  });

  it("counts a required child placed anywhere in the tree as satisfied", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({
        type: "stack",
        children: [
          { type: "stack", children: [{ type: "core", ref: "name" }] },
          { type: "core", ref: "modStatusBadge" },
        ],
      }),
      childrenOf("server.row"),
    );

    expect(rootChildren(resolved)).toEqual([
      { type: "stack", children: [{ type: "core", ref: "name" }] },
      { type: "core", ref: "modStatusBadge" },
    ]);
    expect(issues).toEqual([]);
  });

  it("re-appends a required child whose only leaf was dropped as an unknown ref", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "stack", children: [{ type: "core", ref: "joinAction" }] }),
      childrenOf("server.row"),
    );

    expect(rootChildren(resolved)).toEqual([
      { type: "core", ref: "modStatusBadge" },
      { type: "core", ref: "name" },
    ]);
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message: "core ref 'joinAction' is not a child of slot 'server.row' — leaf dropped",
      },
    ]);
  });
});

describe("resolveComponentTree envelope", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "components/server-row.json"],
    ["a number", 42],
    ["an array", []],
    ["no root key", { slot: "server.row" }],
    ["root present but undefined", { slot: "server.row", root: undefined }],
    ["a slot that disagrees with the argument", { slot: "mods.row", root: { type: "stack" } }],
    ["no slot key", { root: { type: "stack" } }],
  ])("returns tree: null and one issue for %s, without throwing", (_label, json) => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      json,
      childrenOf("server.row"),
    );

    expect(resolved).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0].slotId).toBe("server.row");
  });

  it("returns tree: null for a root that is itself a core leaf", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "core", ref: "name" }),
      childrenOf("server.row"),
    );

    expect(resolved).toBeNull();
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message: "component tree root is a 'core' leaf, not a container — tree ignored",
      },
    ]);
  });

  it("returns tree: null when the root node is unrecognisable", () => {
    const { tree: resolved, issues } = resolveComponentTree(
      "server.row",
      tree({ type: "iframe", src: "https://example.com" }),
      childrenOf("server.row"),
    );

    expect(resolved).toBeNull();
    expect(issues).toEqual([
      {
        slotId: "server.row",
        message: "node type 'iframe' is not one of stack, box, grid, core — node dropped",
      },
    ]);
  });
});
