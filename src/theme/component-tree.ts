// Resolves a theme's component-composition file (`components/<slot>.json`)
// against the live slot registry: `layout-store.ts`'s problem, applied to a
// tree instead of a flat list. Pure data in, pure data out — no DOM, no React,
// no IPC. `component-tree-renderer.tsx` renders the result; this file only has
// to be correct about the shape.
//
// The backend validates the envelope and nothing else, so every node type,
// every prop and every `ref` is untrusted here.

import { LITERAL_CSS_VALUE } from "./layout-store";
import type { LayoutIssue } from "./layout-store";
import type { SlotChild } from "./slots";

/** The closed primitive vocabulary (§4.3): three layout containers, a leaf type
 * that can only name a child the slot registry already has, and a decorative
 * image. There is no `html`, `iframe` or `script` node, and there never will be
 * under this design — that restriction is what keeps "no theme-authored code"
 * true. */
export type ComponentNode =
  | (ContainerProps & { children: ComponentNode[] })
  | CoreLeaf
  | ImageLeaf;

/** The same shape with every prop and every `ref` already checked, so a
 * renderer consuming one never re-validates anything — the contract
 * `ResolvedSlotLayout` gives `layout.json` consumers. */
export type ResolvedNode = ResolvedContainer | CoreLeaf | ImageLeaf;

/** A node's placement inside its parent's bounds, replacing normal flow. */
export interface Position {
  anchor: PositionAnchor;
  /** Offsets from the anchor, as literal CSS values. */
  x?: string;
  y?: string;
}

export type PositionAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

/** Props every node type carries, whichever shape it has. */
interface NodeProps {
  position?: Position;
}

interface ContainerProps extends NodeProps {
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

interface CoreLeaf extends NodeProps {
  type: "core";
  /** A child id of the slot being resolved. */
  ref: string;
  grow?: boolean;
}

/** Decoration only: never bound to data, never interactive, never a stand-in
 * for a `core` element. */
interface ImageLeaf extends NodeProps {
  type: "image";
  /** A path relative to the theme's own root, by convention under its `assets/`. */
  asset: string;
  grow?: boolean;
}

type Direction = NonNullable<ContainerProps["direction"]>;
type Align = NonNullable<ContainerProps["align"]>;
type Justify = NonNullable<ContainerProps["justify"]>;

const CONTAINER_TYPES = ["stack", "box", "grid"] as const;
const DIRECTIONS: readonly Direction[] = ["row", "column"];
const ALIGNS: readonly Align[] = ["start", "center", "end", "stretch"];
const JUSTIFIES: readonly Justify[] = ["start", "center", "end", "space-between"];
const ANCHORS: readonly PositionAnchor[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];
const NODE_TYPES = "stack, box, grid, core, image";

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
  if (root === null || !isContainerNode(root)) {
    if (root !== null) {
      issues.push({
        slotId,
        message: `component tree root is a '${root.type}' leaf, not a container — tree ignored`,
      });
    }
    return { tree: null, issues };
  }

  appendMissingRequired(root, registryChildren);
  reportOcclusions(root, registryChildren, slotId, issues);
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
  if (type === "image") return imageLeaf(value, slotId, issues);
  if (!isContainerType(type)) {
    issues.push({
      slotId,
      message: `node type '${describe(type)}' is not one of ${NODE_TYPES} — node dropped`,
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
  applyPosition(container, value, slotId, issues);

  return container;
}

/** A path relative to the theme's own root — never absolute, never outside the
 * package (§11.5). Existence and file type are checked at import, not here. */
function isRelativeAssetPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

function imageLeaf(
  node: Record<string, unknown>,
  slotId: string,
  issues: LayoutIssue[],
): ImageLeaf | null {
  const asset = node.asset;
  if (!isRelativeAssetPath(asset)) {
    issues.push({
      slotId,
      message: `image 'asset' must be a path inside the theme ('${describe(asset)}') — leaf dropped`,
    });
    return null;
  }

  const leaf: ImageLeaf = { type: "image", asset };
  applyLeafProps(leaf, node, slotId, issues);
  return leaf;
}

function applyLeafProps(
  leaf: CoreLeaf | ImageLeaf,
  node: Record<string, unknown>,
  slotId: string,
  issues: LayoutIssue[],
): void {
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
  applyPosition(leaf, node, slotId, issues);
}

/** `position` is legal on every node type. An anchor outside the nine drops the
 * whole field — there is no placement without one — while an `x`/`y` that isn't
 * a literal CSS value drops just that offset. */
function applyPosition(
  node: NodeProps,
  value: Record<string, unknown>,
  slotId: string,
  issues: LayoutIssue[],
): void {
  if (value.position === undefined) return;
  const raw = value.position;
  if (!isPlainObject(raw)) {
    issues.push({
      slotId,
      message: `'position' must be an object ('${describe(raw)}') — prop dropped`,
    });
    return;
  }

  const anchor = pickEnum(raw, "anchor", ANCHORS, slotId, issues);
  if (anchor === undefined) return;

  const position: Position = { anchor };
  for (const axis of ["x", "y"] as const) {
    const offset = raw[axis];
    if (offset === undefined) continue;
    if (typeof offset === "string" && LITERAL_CSS_VALUE.test(offset)) {
      position[axis] = offset;
    } else {
      issues.push({
        slotId,
        message: `position '${axis}' is not a literal value ('${describe(offset)}') — offset dropped`,
      });
    }
  }
  node.position = position;
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
  applyLeafProps(leaf, node, slotId, issues);
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

/** Visits every node in a resolved tree: containers, core and image leaves
 * alike — a leaf's children don't exist, so this simply ends there. */
function walkTree(node: ResolvedNode, visit: (node: ResolvedNode) => void): void {
  visit(node);
  if (isContainerNode(node)) for (const child of node.children) walkTree(child, visit);
}

function collectRefs(node: ResolvedNode, into: Set<string>): void {
  walkTree(node, (visited) => {
    if (visited.type === "core") into.add(visited.ref);
  });
}

/** Only the statically decidable sliver of §4.3's occlusion rule: two siblings
 * pinned to the identical anchor and offsets definitely overlap, so if one of
 * them is a required core ref, that ref is buried. Flow siblings' bounds are
 * unknowable statically, and a 1px offset difference is left to the runtime
 * Activation Safety Window rather than guessed at. */
function reportOcclusions(
  root: ResolvedContainer,
  registryChildren: SlotChild[],
  slotId: string,
  issues: LayoutIssue[],
): void {
  walkTree(root, (parent) => {
    if (!isContainerNode(parent)) return;
    for (let i = 0; i < parent.children.length; i++) {
      for (let j = i + 1; j < parent.children.length; j++) {
        const a = parent.children[i];
        const b = parent.children[j];
        if (a.position === undefined || b.position === undefined) continue;
        // Identical anchor and identical offsets, both omitted counting as equal.
        if (
          a.position.anchor !== b.position.anchor ||
          a.position.x !== b.position.x ||
          a.position.y !== b.position.y
        ) {
          continue;
        }
        // Either side covering the other is the same finding, so one name is enough.
        const buried = [a, b].find(
          (node) =>
            node.type === "core" &&
            registryChildren.find((child) => child.id === node.ref)?.required === true,
        );
        if (buried === undefined || buried.type !== "core") continue;
        issues.push({
          slotId,
          message: `${describeNode(a)} and ${describeNode(b)} sit at anchor '${a.position.anchor}' with the same offsets, occluding required core ref '${buried.ref}'`,
        });
      }
    }
  });
}

function describeNode(node: ResolvedNode): string {
  if (node.type === "core") return `core '${node.ref}'`;
  if (node.type === "image") return `image '${node.asset}'`;
  return `'${node.type}' container`;
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

/** A type guard, so `ResolvedNode` narrows to the container arm. */
function isContainerNode(node: ResolvedNode): node is ResolvedContainer {
  return node.type === "stack" || node.type === "box" || node.type === "grid";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}
