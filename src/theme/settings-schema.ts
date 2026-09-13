// Resolves a theme's `settings.schema.json` into the fields core renders, and
// substitutes a user's tuned values into a theme's `tokens.json`/`layout.json`.
// Pure data in, pure data out: no DOM, no React, no IPC — same shape of problem
// as `layout-store.ts`, and the same fail-open-with-an-issue philosophy.
//
// The backend only confirms the file is a JSON object with a `schemaVersion`;
// every field id, type and bound is untrusted here. Substitution is plain text
// replacement, never an expression language (proposal §4.4).

import type { LayoutIssue } from "./layout-store";

/** The only two types a schema field may declare (§0 decision 3). */
export type SettingsField =
  | { id: string; type: "number"; label: string; min: number; max: number; default: number }
  | { id: string; type: "boolean"; label: string; default: boolean };

/** Every valid field in a well-formed `settings.schema.json`, in file order.
 * A malformed entry is dropped with an issue of its own; the rest still load. */
export function resolveSettingsSchema(schemaJson: unknown): {
  fields: SettingsField[];
  issues: LayoutIssue[];
} {
  if (!isPlainObject(schemaJson) || !Array.isArray(schemaJson.fields)) {
    return {
      fields: [],
      issues: [
        {
          slotId: "",
          message: "settings.schema.json must be a JSON object with a `fields` array",
        },
      ],
    };
  }

  const fields: SettingsField[] = [];
  const issues: LayoutIssue[] = [];
  for (const entry of schemaJson.fields) {
    const field = readField(entry, issues);
    if (field) fields.push(field);
  }
  return { fields, issues };
}

/** One entry, or null with an issue pushed. `slotId` carries the field id when
 * the entry has one, so the issue points at the line a theme author wrote. */
function readField(entry: unknown, issues: LayoutIssue[]): SettingsField | null {
  if (!isPlainObject(entry)) {
    issues.push({ slotId: "", message: `a field entry is not an object ('${describe(entry)}')` });
    return null;
  }

  const { id, type, label, default: fallback, min, max } = entry;
  const where = typeof id === "string" && id !== "" ? id : "";
  const fail = (reason: string): null => {
    issues.push({ slotId: where, message: `field '${describe(id)}' ${reason}` });
    return null;
  };

  if (typeof id !== "string" || id === "") return fail("has no string `id`");
  if (typeof label !== "string" || label === "") return fail("has no string `label`");

  if (type === "number") {
    if (typeof fallback !== "number") return fail("declares `type: \"number\"` but no numeric `default`");
    if (typeof min !== "number" || typeof max !== "number") {
      return fail("declares `type: \"number\"` but no numeric `min`/`max`");
    }
    if (min > max) return fail(`has min ${min} above max ${max}`);
    return { id, type, label, min, max, default: fallback };
  }

  if (type === "boolean") {
    if (typeof fallback !== "boolean") {
      return fail("declares `type: \"boolean\"` but no boolean `default`");
    }
    return { id, type, label, default: fallback };
  }

  return fail(`has unknown type '${describe(type)}'`);
}

/**
 * Replace every recognised `{{fieldId}}` in a `tokens.json`- or `layout.json`-
 * shaped value with that field's tuned value.
 *
 * A string that is *exactly* one placeholder becomes the value's own typed form
 * — a number stays a number, a boolean stays a boolean — so a whole-string match
 * can change the JSON type of that slot (`"density": "{{compactRows}}"` feeds a
 * typed field). A placeholder *inside* a longer string is a plain text
 * replacement instead, e.g. `"hsl({{accentHue}}, 45%, 60%)"`.
 *
 * A placeholder naming a field with no tuned value is left as the literal
 * `{{fieldId}}` in both cases. This function only substitutes — it never
 * decides whether the result is usable, so the caller still runs the result
 * through whatever check gated that value before, and an unresolved placeholder
 * fails it the same way any other malformed value does.
 */
export function substitutePlaceholders(
  json: unknown,
  values: Record<string, number | boolean>,
): unknown {
  if (typeof json === "string") return substituteString(json, values);
  if (Array.isArray(json)) return json.map((entry) => substitutePlaceholders(entry, values));
  if (isPlainObject(json)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json)) {
      result[key] = substitutePlaceholders(value, values);
    }
    return result;
  }
  return json;
}

const WHOLE_PLACEHOLDER = /^\{\{(.+)\}\}$/;
const PLACEHOLDER = /\{\{(.+?)\}\}/g;

function substituteString(text: string, values: Record<string, number | boolean>): unknown {
  const known = (id: string) => Object.prototype.hasOwnProperty.call(values, id);
  const whole = WHOLE_PLACEHOLDER.exec(text);
  if (whole && known(whole[1])) return values[whole[1]];
  // Unrecognised fragments are left verbatim — a literal `{{id}}` fails the
  // caller's own downstream check rather than being silently dropped.
  return text.replace(PLACEHOLDER, (match, id: string) =>
    known(id) ? String(values[id]) : match,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}
