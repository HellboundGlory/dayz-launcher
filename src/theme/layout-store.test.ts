/** The layout resolver against the real slot registry: forward-compat
 * forgiveness (unknown ids dropped quietly) versus authoring mistakes
 * (hiding a required child, a non-literal param value), which must surface. */
import { describe, expect, it } from "vitest";
import { resolveLayout } from "./layout-store";
import { SLOTS } from "./slots";

const registryOrder = (id: string) => {
  const slot = SLOTS.find((candidate) => candidate.id === id);
  if (!slot) throw new Error(`no slot '${id}' in SLOTS`);
  return slot.children.map((child) => child.id);
};

const layout = (slots: Record<string, Record<string, unknown>>) => ({ schemaVersion: 1, slots });

describe("resolveLayout defaults", () => {
  it("gives every slot its registry-order children, nothing hidden, empty params", () => {
    const { resolved, issues } = resolveLayout(SLOTS, null);

    expect(Object.keys(resolved)).toEqual(SLOTS.map((slot) => slot.id));
    for (const slot of SLOTS) {
      expect(resolved[slot.id]).toEqual({
        children: slot.children.map((child) => child.id),
        hidden: [],
        params: {},
      });
    }
    expect(issues).toEqual([]);
  });

  it("leaves an unmentioned slot at that default", () => {
    const { resolved, issues } = resolveLayout(SLOTS, layout({ "shell.header": {} }));

    expect(resolved["mods.inspector"]).toEqual({
      children: registryOrder("mods.inspector"),
      hidden: [],
      params: {},
    });
    expect(issues).toEqual([]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "layout.json"],
    ["a number", 42],
    ["an array", []],
    ["no schemaVersion", { slots: {} }],
    ["no slots object", { schemaVersion: 1 }],
    ["slots as an array", { schemaVersion: 1, slots: [] }],
  ])("treats %s as no layout at all, without issues", (_label, json) => {
    const { resolved, issues } = resolveLayout(SLOTS, json);

    expect(resolved["server.row"]).toEqual({
      children: registryOrder("server.row"),
      hidden: [],
      params: {},
    });
    expect(issues).toEqual([]);
  });

  it("ignores a slot layout entry that is not an object", () => {
    const { resolved, issues } = resolveLayout(SLOTS, layout({ "server.row": null as never }));

    expect(resolved["server.row"].children).toEqual(registryOrder("server.row"));
    expect(issues).toEqual([]);
  });
});

describe("resolveLayout children", () => {
  it("honours an explicit order", () => {
    const { resolved, issues } = resolveLayout(SLOTS, layout({ "shell.header": { order: ["dragRegion", "windowControls"] } }));

    expect(resolved["shell.header"].children).toEqual(["dragRegion", "windowControls"]);
    expect(issues).toEqual([]);
  });

  it("appends every required child a partial order left out — server.row's real shape", () => {
    // An old theme that reordered a couple of rows predates modStatusBadge;
    // all three of server.row's required children must still end up present.
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "server.row": { order: ["pingBadge", "name", "joinAction"] } }),
    );

    expect(resolved["server.row"].children).toEqual([
      "pingBadge",
      "name",
      "joinAction",
      "modStatusBadge",
    ]);
    expect(issues).toEqual([]);
  });

  it("drops an order entry that is not a real child, with no issue", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "server.row": { order: ["ghostLabel", "joinAction"] } }),
    );

    expect(resolved["server.row"].children).toEqual(["joinAction", "name", "modStatusBadge"]);
    expect(issues).toEqual([]);
  });

  it("falls back to registry order when order is not an array", () => {
    const { resolved } = resolveLayout(SLOTS, layout({ "shell.header": { order: "windowControls" } }));

    expect(resolved["shell.header"].children).toEqual(registryOrder("shell.header"));
  });
});

describe("resolveLayout hidden", () => {
  it("hides a real optional child", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "shell.sidebar": { hidden: ["navFavourites", "navRecent"] } }),
    );

    expect(resolved["shell.sidebar"].hidden).toEqual(["navFavourites", "navRecent"]);
    expect(resolved["shell.sidebar"].children).not.toContain("navFavourites");
    expect(resolved["shell.sidebar"].children).toContain("navList");
    expect(issues).toEqual([]);
  });

  it("refuses to hide a required child and reports it", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "shell.sidebar": { hidden: ["navList"] } }),
    );

    expect(resolved["shell.sidebar"].hidden).toEqual([]);
    expect(resolved["shell.sidebar"].children).toContain("navList");
    expect(issues).toEqual([
      {
        slotId: "shell.sidebar",
        message: "cannot hide required child 'navList' in slot 'shell.sidebar'",
      },
    ]);
  });

  it("drops a hidden entry that is not a real child of that slot, with no issue", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "shell.header": { hidden: ["navList", "noSuchChild"] } }),
    );

    expect(resolved["shell.header"].hidden).toEqual([]);
    expect(resolved["shell.header"].children).toEqual(registryOrder("shell.header"));
    expect(issues).toEqual([]);
  });
});

describe("resolveLayout unknown slot ids", () => {
  it("ignores a slot id the registry does not have", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "mods.graph": { order: ["sparkline"], width: "40%" } }),
    );

    expect(Object.keys(resolved)).toEqual(SLOTS.map((slot) => slot.id));
    expect("mods.graph" in resolved).toBe(false);
    expect(issues).toEqual([]);
  });
});

describe("resolveLayout params", () => {
  it("keeps literal lengths, var() references and plain keywords", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({
        "mods.actionBar": {
          position: "sticky",
          width: "12rem",
          minWidth: "240px",
          maxHeight: "78.5vh",
          ratio: 0.25,
          collapsed: true,
          gap: "var(--space-md)",
        },
      }),
    );

    expect(resolved["mods.actionBar"].params).toEqual({
      position: "sticky",
      width: "12rem",
      minWidth: "240px",
      maxHeight: "78.5vh",
      ratio: 0.25,
      collapsed: true,
      gap: "var(--space-md)",
    });
    expect(issues).toEqual([]);
  });

  it("drops a value containing a space and reports it", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "mods.actionBar": { class: "flex gap-2 px-4 text-sm", position: "left" } }),
    );

    expect(resolved["mods.actionBar"].params).toEqual({ position: "left" });
    expect(issues).toEqual([
      {
        slotId: "mods.actionBar",
        message:
          "'class' is not a literal value ('flex gap-2 px-4 text-sm') — Tailwind class names are never valid here, only CSS lengths, var() references, or plain keywords",
      },
    ]);
  });

  it("accepts a bare word as a keyword — a lone class name is indistinguishable from one", () => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "mods.toolbar": { density: "compact", position: "left" } }),
    );

    expect(resolved["mods.toolbar"].params).toEqual({ density: "compact", position: "left" });
    expect(issues).toEqual([]);
  });

  it.each([
    ["a dot-leading selector", ".card"],
    ["a spaced class list", "gap-2 px-4"],
    ["an object", { px: 4 }],
    ["an array", ["left"]],
    ["null", null],
  ])("drops %s from params", (_label, value) => {
    const { resolved, issues } = resolveLayout(
      SLOTS,
      layout({ "mods.toolbar": { weird: value } }),
    );

    expect(resolved["mods.toolbar"].params).toEqual({});
    expect(resolved["mods.toolbar"].children).toEqual(registryOrder("mods.toolbar"));
    expect(issues).toHaveLength(1);
    expect(issues[0].slotId).toBe("mods.toolbar");
  });
});
