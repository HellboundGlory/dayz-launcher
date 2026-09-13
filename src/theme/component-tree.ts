// Resolves a theme's component-composition file (`components/<slot>.json`)
// against the live slot registry: `layout-store.ts`'s problem, applied to a
// tree instead of a flat list. Pure data in, pure data out — no DOM, no React,
// no IPC. Nothing renders the result yet; a later package does that, so this
// one only has to be correct about the shape.
//
// The backend validates the envelope and nothing else, so every node type,
// every prop and every `ref` is untrusted here.

import type { LayoutIssue } from "./layout-store";
import type { SlotChild } from "./slots";

/** The closed primitive vocabulary (§4.3): three layout containers plus one
 * leaf type that can only name a child the slot registry already has. There is
 * no `html`, `iframe` or `script` node, and there never will be under this
 * design — that restriction is what keeps "no theme-authored code" true. */
export type ComponentNode = (ContainerProps & { children: ComponentNode[] }) | CoreLeaf;

/** The same shape with every prop and every `ref` already checked, so a
 * renderer consuming one never re-validates anything — the contract
 * `ResolvedSlotLayout` gives `layout.json` consumers. */
export type ResolvedNode = ResolvedContainer | CoreLeaf;

interface ContainerProps {
  type: "stack" | "box" | "grid";
  direction?: "row" | "column";
  gap?: string;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between";
  wrap?: boolean;
}

interface ResolvedContainer extends ContainerProps {
  children: ResolvedNode[];
}

interface CoreLeaf {
  type: "core";
  /** A child id of the slot being resolved. */
  ref: string;
  grow?: boolean;
}

type Direction = NonNullable<ContainerProps["direction"]>;
type Align = NonNullable<ContainerProps["align"]>;
type Justify = NonNullable<ContainerProps["justify"]>;

const CONTAINER_TYPES = ["stack", "box", "grid"] as const;
const DIRECTIONS: readonly Direction[] = ["row", "column"];
const ALIGNS: readonly Align[] = ["start", "center", "end", "stretch"];
const JUSTIFIES: readonly Justify[] = ["start", "center", "end", "space-between"];

// layout-store.ts's literal-value rule, which stays private to that module: a
// value that ends up in CSS has to be a length, a `var()` reference or a bare
// keyword. A class name would ship with no CSS behind it — Tailwind's
// build-time content scan never sees a runtime-chosen string.
const LITERAL_CSS_VALUE =
  /^(?:-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)|var\(--[a-z0-9-]+\)|[a-z0-9][a-z0-9-]*)$/i;

/** `tree: null` means "fall back to the ordinary non-composed render", exactly
 * how a slot with no `layout.json` entry falls back to registry order. Every
 * other mistake becomes an issue on the offending node or prop while the rest
 * of the tree still resolves: one bad apple never spoils the batch. */
export function resolveComponentTree(
  slotId: string,
  treeJson: unknown,
  registryChildren: SlotChild[],
): { tree: ResolvedNode | null; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = [];

  if (!isPlainObject(treeJson)) {
    issues.push({ slotId, message: `component tree is not an object ('${describe(treeJson)}')` });
    return { tree: null, issues };
  }
  if (!("root" in treeJson)) {
    issues.push({ slotId, message: "component tree has no 'root' node" });
    return { tree: null, issues };
  }
  if (treeJson.slot !== slotId) {
    issues.push({
      slotId,
      message: `component tree is composition for '${describe(treeJson.slot)}', not '${slotId}'`,
    });
    return { tree: null, issues };
  }

  const root = walk(treeJson.root, slotId, registryChildren, issues);
  // No container at the root means the auto-append rule has nowhere to land,
  // so a required child could vanish — that is a fallback, not a partial tree.
  if (root === null || root.type === "core") {
    if (root !== null) {
      issues.push({
        slotId,
        message: "component tree root is a 'core' leaf, not a container — tree ignored",
      });
    }
    return { tree: null, issues };
  }

  appendMissingRequired(root, registryChildren);
  return { tree: root, issues };
}

function walk(
  value: unknown,
  slotId: string,
  registryChildren: SlotChild[],
  issues: LayoutIssue[],
): ResolvedNode | null {
  if (!isPlainObject(value)) {
    issues.push({ slotId, message: `node is not an object ('${describe(value)}') — node dropped` });
    return null;
  }

  const type = value.type;
  if (type === "core") return coreLeaf(value, slotId, registryChildren, issues);
  if (!isContainerType(type)) {
    issues.push({
      slotId,
      message: `node type '${describe(type)}' is not one of stack, box, grid, core — node dropped`,
    });
    return null;
  }

  const children: ResolvedNode[] = [];
  // A node with no recognisable children array is an empty container, not an
  // error — the quiet drop `resolveLayout` already gives an unknown child id.
  if (Array.isArray(value.children)) {
    for (const child of value.children) {
      const node = walk(child, slotId, registryChildren, issues);
      if (node !== null) children.push(node);
    }
  }

  const container: ResolvedContainer = { type, children };
  const direction = pickEnum(value, "direction", DIRECTIONS, slotId, issues);
  if (direction !== undefined) container.direction = direction;
  // `gap` is the one container prop that becomes a raw CSS value instead of a
  // value from a four-keyword enum, so it gets the literal-value rule — a
  // Tailwind class name here would ship with no CSS behind it.
  if (value.gap !== undefined) {
    if (typeof value.gap === "string" && LITERAL_CSS_VALUE.test(value.gap)) {
      container.gap = value.gap;
    } else {
      issues.push({
        slotId,
        message: `'gap' is not a literal value ('${describe(value.gap)}') — Tailwind class names are never valid here, only CSS lengths, var() references, or plain keywords`,
      });
    }
  }
  const align = pickEnum(value, "align", ALIGNS, slotId, issues);
  if (align !== undefined) container.align = align;
  const justify = pickEnum(value, "justify", JUSTIFIES, slotId, issues);
  if (justify !== undefined) container.justify = justify;
  if (value.wrap !== undefined) {
    if (typeof value.wrap === "boolean") {
      container.wrap = value.wrap;
    } else {
      issues.push({
        slotId,
        message: `'wrap' must be a boolean ('${describe(value.wrap)}') — prop dropped`,
      });
    }
  }

  return container;
}

function coreLeaf(
  node: Record<string, unknown>,
  slotId: string,
  registryChildren: SlotChild[],
  issues: LayoutIssue[],
): CoreLeaf | null {
  const ref = node.ref;
  if (typeof ref !== "string" || !registryChildren.some((child) => child.id === ref)) {
    issues.push({
      slotId,
      message: `core ref '${describe(ref)}' is not a child of slot '${slotId}' — leaf dropped`,
    });
    return null;
  }

  const leaf: CoreLeaf = { type: "core", ref };
  if (node.grow !== undefined) {
    if (typeof node.grow === "boolean") {
      leaf.grow = node.grow;
    } else {
      issues.push({
        slotId,
        message: `'grow' must be a boolean ('${describe(node.grow)}') — prop dropped`,
      });
    }
  }
  return leaf;
}

/** §3.3's guarantee, over a tree: a theme cannot swallow new required content
 * by composing a tree that omits it. A tree has no "end" to append to, so the
 * missing children land as extra `core` leaves under its own root, in registry
 * order — the only well-defined spot a tree has. */
function appendMissingRequired(root: ResolvedContainer, registryChildren: SlotChild[]): void {
  const placed = new Set<string>();
  collectRefs(root, placed);
  for (const child of registryChildren) {
    if (child.required && !placed.has(child.id)) root.children.push({ type: "core", ref: child.id });
  }
}

function collectRefs(node: ResolvedNode, into: Set<string>): void {
  if (node.type === "core") {
    into.add(node.ref);
    return;
  }
  for (const child of node.children) collectRefs(child, into);
}

/** One optional enum prop: a value from the list is kept, anything else is an
 * issue and the prop is dropped while the node itself still resolves. */
function pickEnum<T extends string>(
  node: Record<string, unknown>,
  prop: string,
  allowed: readonly T[],
  slotId: string,
  issues: LayoutIssue[],
): T | undefined {
  const value = node[prop];
  if (value === undefined) return undefined;
  const match = allowed.find((option) => option === value);
  if (match !== undefined) return match;
  issues.push({
    slotId,
    message: `'${prop}' must be one of ${allowed.join(", ")} ('${describe(value)}') — prop dropped`,
  });
  return undefined;
}

function isContainerType(value: unknown): value is ResolvedContainer["type"] {
  return CONTAINER_TYPES.some((known) => known === value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}
