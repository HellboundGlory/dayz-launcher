// Resolves a theme's `layout.json` against the live slot registry. Pure data in,
// pure data out: no DOM, no React, no IPC. Nothing renders the result yet — a
// later package does that; this one only has to be correct about the shape.
//
// The backend validates the envelope (object, has `schemaVersion`) and nothing
// else, so every slot id, child id and param value is untrusted here.

import type { Slot } from "./slots";

export interface ResolvedSlotLayout {
  /** Every child that should render, in order — explicit placements from
   * `layout.json` first, then any `required: true` child from the current
   * registry that the theme's file never mentioned, appended at the end. */
  children: string[];
  /** Child ids hidden by this theme — always a subset of `required: false`
   * children; hiding a required one is refused, never honoured. */
  hidden: string[];
  /** Every other per-slot key the theme supplied (position, width,
   * collapsedWidth, density, ...) that passed the literal-value check —
   * opaque to this resolver, a later package interprets them. */
  params: Record<string, unknown>;
}

export type ResolvedLayout = Record<string, ResolvedSlotLayout>;

export interface LayoutIssue {
  slotId: string;
  message: string;
}

// A literal CSS value: a length/percentage, a `var()` reference, or a bare
// keyword (`left`, `compact`). A class list would be pointless — Tailwind's
// build-time content scan never sees a runtime-chosen class name, so the class
// would ship with no CSS behind it.
// Exported for component-tree.ts's `gap` check, which needs the same regex
// but not `isLiteralCssValue`'s number/boolean allowance below — a bare `gap`
// prop only ever makes sense as a string.
export const LITERAL_CSS_VALUE =
  /^(?:-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)|var\(--[a-z0-9-]+\)|[a-z0-9][a-z0-9-]*)$/i;

/** Every slot in `slots` gets an entry, whether or not `layoutJson` mentions it.
 * Ids the registry doesn't have are dropped quietly in both directions; only
 * mistakes a theme author can fix become issues. */
export function resolveLayout(
  slots: Slot[],
  layoutJson: unknown,
): { resolved: ResolvedLayout; issues: LayoutIssue[] } {
  const entries = slotEntries(layoutJson);
  const resolved: ResolvedLayout = {};
  const issues: LayoutIssue[] = [];

  for (const slot of slots) {
    const registryOrder = slot.children.map((child) => child.id);
    const entry = entries?.[slot.id];
    if (!isPlainObject(entry)) {
      resolved[slot.id] = { children: registryOrder, hidden: [], params: {} };
      continue;
    }

    // Explicit placements first, filtered to children that still exist, then
    // every required child the theme never mentioned — a theme cannot make new
    // required content disappear just by omitting it.
    const ordered = Array.isArray(entry.order)
      ? entry.order.filter(
          (id): id is string =>
            typeof id === "string" && slot.children.some((child) => child.id === id),
        )
      : registryOrder.slice();
    for (const child of slot.children) {
      if (child.required && !ordered.includes(child.id)) ordered.push(child.id);
    }
    const hidden: string[] = [];
    if (Array.isArray(entry.hidden)) {
      for (const id of entry.hidden) {
        const child = slot.children.find((candidate) => candidate.id === id);
        // An id this slot no longer has is a forward-compat gap, not a mistake.
        if (!child) continue;
        if (child.required) {
          issues.push({
            slotId: slot.id,
            message: `cannot hide required child '${child.id}' in slot '${slot.id}'`,
          });
        } else if (!hidden.includes(child.id)) {
          hidden.push(child.id);
        }
      }
    }

    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key === "order" || key === "hidden") continue;
      if (isLiteralCssValue(value)) {
        params[key] = value;
      } else {
        issues.push({
          slotId: slot.id,
          message: `'${key}' is not a literal value ('${describe(value)}') — Tailwind class names are never valid here, only CSS lengths, var() references, or plain keywords`,
        });
      }
    }

    resolved[slot.id] = {
      children: ordered.filter((id) => !hidden.includes(id)),
      hidden,
      params,
    };
  }

  return { resolved, issues };
}

/** `layout.json`'s `slots` object, or null for anything the resolver can't read
 * as a manifest at all — a theme without a layout file is not an error. */
function slotEntries(layoutJson: unknown): Record<string, unknown> | null {
  if (typeof layoutJson !== "object" || layoutJson === null) return null;
  const { schemaVersion, slots } = layoutJson as { schemaVersion?: unknown; slots?: unknown };
  if (schemaVersion === undefined || !isPlainObject(slots)) return null;
  return slots;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiteralCssValue(value: unknown): boolean {
  return (
    typeof value === "number" ||
    typeof value === "boolean" ||
    (typeof value === "string" && LITERAL_CSS_VALUE.test(value))
  );
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}
