// The shipped Tactical package, pinned at the file level: its browser view and
// shell are responsive (§5.2) and its Settings overlay leaves the window chrome
// visible (§15). The Rust validator checks the same package for what it may contain.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveVariant } from "./renderer/variant";
import type { LayoutFile, LayoutNode, StackNode } from "./renderer/types";

const read = (relative: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../src-tauri/resources/builtin-themes/builtin.tactical/${relative}`, import.meta.url),
      "utf8",
    ),
  );

const browser = read("layout/views/browser.json") as LayoutFile;
const shell = read("layout/shell.json") as LayoutFile;
const settings = read("layout/settings.json") as {
  presentation?: { mode?: string; region?: string };
};

const browserVariants = browser.variants ?? [];
const shellVariants = shell.variants ?? [];
const [narrowBrowser, wideBrowser] = browserVariants.map((variant) => variant.root);
const [narrowShell, wideShell] = shellVariants.map((variant) => variant.root);

const child = (root: LayoutNode, index: number) => (root as StackNode).children[index];
const bar = (root: LayoutNode) => child(root, 0) as StackNode;
const identify = (node: LayoutNode): string | undefined =>
  node.id ??
  ("element" in node ? node.element : undefined) ??
  ("surface" in node ? node.surface : undefined);
const nodeOptions = (node: LayoutNode): unknown =>
  "element" in node ? node.options : undefined;
const header = (root: LayoutNode) =>
  (root as StackNode).children.find((node) => node.id === "r-header") as StackNode;
const headerChild = (root: LayoutNode, key: string) =>
  header(root).children.find((node) => identify(node) === key)!;
const options = (root: LayoutNode, key: string) => nodeOptions(headerChild(root, key));

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
const hasElement = (node: LayoutNode, id: string) => elements(node).includes(id);

describe("builtin.tactical browser view", () => {
  it("wraps the filter bar below 1400px and keeps the single row above it", () => {
    expect(browserVariants.map((variant) => variant.minWidth)).toEqual([0, 1400]);
    expect(resolveVariant(browser, 650)).toBe(narrowBrowser);
    expect(resolveVariant(browser, 975)).toBe(narrowBrowser);
    expect(resolveVariant(browser, 1399)).toBe(narrowBrowser);
    expect(resolveVariant(browser, 1400)).toBe(wideBrowser);
  });

  it("splits the narrow bar into a filters row and a hides/actions row", () => {
    const narrow = bar(narrowBrowser);
    expect(narrow.direction).toBe("column");
    expect(narrow.children.map((node) => node.id)).toEqual(["r-filterbar-top", "r-filterbar-bottom"]);
    expect(elements(narrow.children[0])).toEqual([
      "filter.search",
      "filter.map",
      "filter.tags",
      "filter.region",
      "filter.mods",
      "filter.maxPing",
    ]);
    expect(elements(narrow.children[1])).toEqual([
      "filter.hideEmpty",
      "filter.hideOffline",
      "filter.hideFull",
      "filter.hideLocked",
      "filter.reset",
      "servers.refresh",
    ]);
  });

  it("lets the filters row wrap at the narrowest window", () => {
    expect((bar(narrowBrowser).children[0] as StackNode).wrap).toBe(true);
    expect(bar(wideBrowser).wrap).toBeUndefined();
  });

  it("places the same elements with the same options as the single row", () => {
    expect(placements(narrowBrowser)).toEqual(placements(wideBrowser));
  });

  it("keeps today's single row at and above the breakpoint", () => {
    const wide = bar(wideBrowser);
    expect(wide.direction).toBe("row");
    expect(elements(wide)).toEqual([
      "filter.search",
      "filter.map",
      "filter.tags",
      "filter.region",
      "filter.mods",
      "filter.maxPing",
      "filter.hideEmpty",
      "filter.hideOffline",
      "filter.hideFull",
      "filter.hideLocked",
      "filter.reset",
      "servers.refresh",
    ]);
  });

  it("keeps the list area shrinkable in both variants", () => {
    for (const root of [narrowBrowser, wideBrowser]) {
      const list = child(root, 1) as StackNode;
      expect(list.minHeight).toBe("0px");
      expect(list.grow).toBe(1);
      expect(hasElement(list, "list.servers")).toBe(true);
    }
  });
});

describe("builtin.tactical shell", () => {
  it("drops the header's labels below 900px so the window controls fit", () => {
    expect(shellVariants.map((variant) => variant.minWidth)).toEqual([0, 900]);
    expect(resolveVariant(shell, 650)).toBe(narrowShell);
    expect(resolveVariant(shell, 975)).toBe(wideShell);
  });

  it("keeps the same header children, brand and navigation in both variants", () => {
    const keys = (root: LayoutNode) => header(root).children.map(identify);
    expect(keys(narrowShell)).toEqual([
      "r-brand",
      "r-nav",
      "app.dragRegion",
      "status.steam",
      "nav.settings",
      "surface.windowControls",
    ]);
    expect(keys(narrowShell)).toEqual(keys(wideShell));
    expect(elements(header(narrowShell))).toEqual([
      "app.logo",
      "nav.servers",
      "nav.favourites",
      "nav.recent",
      "nav.mods",
      "app.dragRegion",
      "status.steam",
      "nav.settings",
    ]);
    expect(elements(header(narrowShell))).toEqual(elements(header(wideShell)));
    expect(regionIds(narrowShell)).toEqual(regionIds(wideShell));
  });

  it("is icon-only when narrow and labelled as today when wide", () => {
    const navOptions = (root: LayoutNode) =>
      (headerChild(root, "r-nav") as StackNode).children.map(nodeOptions);
    expect(options(narrowShell, "status.steam")).toEqual({ display: "dot" });
    expect(options(wideShell, "status.steam")).toBeUndefined();
    expect(navOptions(narrowShell)).toEqual([
      { display: "icon" },
      { display: "icon" },
      { display: "icon" },
      { display: "icon" },
    ]);
    expect(navOptions(wideShell)).toEqual([
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

  it("keeps every element of the wide header in the narrow one", () => {
    const withoutOptions = (node: LayoutNode) => placements(node).map(([id]) => id);
    expect(withoutOptions(header(narrowShell))).toEqual(withoutOptions(header(wideShell)));
  });
});

describe("builtin.tactical settings overlay", () => {
  it("covers the main area only, so r-header keeps the window controls visible", () => {
    expect(settings.presentation).toMatchObject({ mode: "overlay", region: "r-main" });
    expect(regionIds(wideShell)).toContain("r-main");
  });
});
