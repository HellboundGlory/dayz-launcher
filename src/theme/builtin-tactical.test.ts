// The shipped Tactical package's layout invariants. The harness shoots it at
// 1400 and 975 wide, so the <900 narrow shell is only covered here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LayoutFile, LayoutNode, StackNode } from "./renderer/types";
import { resolveVariant } from "./renderer/variant";

const read = (relative: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../src-tauri/resources/builtin-themes/builtin.tactical/${relative}`, import.meta.url),
      "utf8",
    ),
  );

const browser = read("layout/views/browser.json") as LayoutFile;
const shell = read("layout/shell.json") as LayoutFile;
const settings = read("layout/settings.json") as LayoutFile;

const browserVariants = browser.variants ?? [];
const shellVariants = shell.variants ?? [];
const [narrowBrowser, wideBrowser] = browserVariants.map((variant) => variant.root);
const [narrowShell, wideShell] = shellVariants.map((variant) => variant.root);
const VARIANTS: [string, LayoutNode][] = [
  ["narrow", narrowBrowser],
  ["wide", wideBrowser],
];

const identify = (node: LayoutNode): string | undefined =>
  node.id ??
  ("element" in node ? node.element : undefined) ??
  ("surface" in node ? node.surface : undefined);
const nodeOptions = (node: LayoutNode): unknown =>
  "element" in node ? node.options : undefined;
const elements = (node: LayoutNode): string[] =>
  "element" in node && node.element !== undefined
    ? [node.element]
    : "children" in node && node.children !== undefined
      ? node.children.flatMap(elements)
      : [];
const placements = (node: LayoutNode): [string, unknown][] =>
  "element" in node && node.element !== undefined
    ? [[node.element, node.options]]
    : "children" in node && node.children !== undefined
      ? node.children.flatMap(placements)
      : [];
const regionIds = (node: LayoutNode): string[] => [
  ...(node.id === undefined ? [] : [node.id]),
  ...("children" in node && node.children !== undefined ? node.children.flatMap(regionIds) : []),
];
const findRegion = (node: LayoutNode, id: string): StackNode | undefined => {
  if (node.id === id) return node as StackNode;
  for (const child of (node as StackNode).children ?? []) {
    const hit = findRegion(child, id);
    if (hit) return hit;
  }
  return undefined;
};

const bar = (root: LayoutNode) => (root as StackNode).children[0] as StackNode;
const header = (root: LayoutNode) =>
  (root as StackNode).children.find((node) => node.id === "r-header") as StackNode;
const headerChild = (root: LayoutNode, key: string) =>
  header(root).children.find((node) => identify(node) === key)!;
const options = (root: LayoutNode, key: string) => nodeOptions(headerChild(root, key));

describe("builtin.tactical browser view", () => {
  it("wraps the filter bar below 1400px and keeps the single row above it", () => {
    expect(browserVariants.map((variant) => variant.minWidth)).toEqual([0, 1400]);
    expect(resolveVariant(browser, 650)).toBe(narrowBrowser);
    expect(resolveVariant(browser, 975)).toBe(narrowBrowser);
    expect(resolveVariant(browser, 1399)).toBe(narrowBrowser);
    expect(resolveVariant(browser, 1400)).toBe(wideBrowser);
  });

  it("lets the filters row wrap at the narrowest window", () => {
    expect((bar(narrowBrowser).children[0] as StackNode).wrap).toBe(true);
    expect(bar(wideBrowser).wrap).toBeUndefined();
  });

  it("places the same elements with the same options in both variants", () => {
    expect(placements(narrowBrowser)).toEqual(placements(wideBrowser));
  });

  it.each(VARIANTS)("%s: keeps the list area shrinkable", (_variant, root) => {
    const list = (root as StackNode).children.find((node) =>
      elements(node).includes("list.servers"),
    ) as StackNode;
    expect(list.minHeight).toBe("0px");
    expect(list.grow).toBe(1);
  });

  it.each(VARIANTS)("%s: keeps every region id unique", (_variant, root) => {
    const ids = regionIds(root);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(VARIANTS)("%s: the join button asks to fix and join", (_variant, root) => {
    const join = findRegion(root, "r-join")!.children.find((node) => identify(node) === "server.join")!;
    expect(nodeOptions(join)).toEqual({ wording: "fixAndJoin" });
  });
});

describe("builtin.tactical shell", () => {
  it("drops the header's labels below 900px so the window controls fit", () => {
    expect(shellVariants.map((variant) => variant.minWidth)).toEqual([0, 900]);
    expect(resolveVariant(shell, 650)).toBe(narrowShell);
    expect(resolveVariant(shell, 975)).toBe(wideShell);
  });

  it("is icon-only when narrow and labelled as today when wide", () => {
    expect(options(narrowShell, "status.steam")).toEqual({ display: "dot" });
    expect(options(wideShell, "status.steam")).toBeUndefined();
    expect((headerChild(narrowShell, "r-nav") as StackNode).children.map(nodeOptions)).toEqual([
      { display: "icon" },
      { display: "icon" },
      { display: "icon" },
      { display: "icon" },
    ]);
    expect((headerChild(wideShell, "r-nav") as StackNode).children.map(nodeOptions)).toEqual([
      { display: "iconLabel" },
      { display: "iconLabel" },
      { display: "iconLabel" },
      { display: "iconLabel" },
    ]);
    const brandLogo = (root: LayoutNode) =>
      nodeOptions((headerChild(root, "r-brand") as StackNode).children[0]);
    expect(brandLogo(narrowShell)).toEqual({ wordmark: false });
    expect(brandLogo(wideShell)).toBeUndefined();
  });

  it("keeps the same header children, brand and navigation in both variants", () => {
    expect(header(narrowShell).children.map(identify)).toEqual(header(wideShell).children.map(identify));
    expect(elements(header(narrowShell))).toEqual(elements(header(wideShell)));
    expect(regionIds(narrowShell)).toEqual(regionIds(wideShell));
  });
});

describe("builtin.tactical settings overlay", () => {
  it("leaves the body's height floor to styles.css", () => {
    // An inline floor cannot be given up in the narrow block, which is what
    // keeps the header, the panes and the footer inside a 413px-tall window.
    const dialog = (settings.root as StackNode).children.find((node) => node.id === "r-settings") as StackNode;
    const body = dialog.children.find((node) => node.id === "r-settings-body")!;
    expect(body.minHeight).toBeUndefined();
    expect(body.grow).toBe(1);
  });
});

describe("builtin.tactical mods list", () => {
  const mods = read("layout/lists/mods.json") as LayoutFile;
  const name = mods.columns!.find((col) => col.id === "name")!;

  it("scrolls sideways instead of clipping columns, flooring the flexible name column", () => {
    expect(mods.overflowX).toBe("scroll");
    // A `1fr` track with no floor collapses once the fixed columns fill the list.
    expect(name.width).toBe("1fr");
    expect(name.minWidth).toBe("96px");
  });
});
