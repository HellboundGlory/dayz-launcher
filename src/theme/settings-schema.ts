// Theme settings field and combination shapes, plus user-tuned value substitution.
import type { SettingsValue } from "@/theme/theme-store";

export type SettingsField =
  | { id: string; type: "number"; label: string; min: number; max: number; step?: number; default: number }
  | { id: string; type: "boolean"; label: string; default: boolean }
  | { id: string; type: "choice"; label: string; options: { value: string; label: string }[]; default: string }
  | { id: string; type: "color"; label: string; default: string };

/** One settings combination Dev Mode can apply. `values` holds every field
 * (non-discrete ones at their default), since it replaces the stored values outright. */
export interface SettingsCombination {
  values: Record<string, SettingsValue>;
  label: string;
}

const COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

/** Whether `value` is a complete `#rrggbb` — the only colour form the store takes. */
export function isHexColor(value: string): boolean {
  return COLOR_HEX_REGEX.test(value);
}

export function substitutePlaceholders(
  json: unknown,
  values: Record<string, string | number | boolean>,
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

function substituteString(
  text: string,
  values: Record<string, string | number | boolean>,
): unknown {
  const known = (id: string) => Object.prototype.hasOwnProperty.call(values, id);
  const whole = WHOLE_PLACEHOLDER.exec(text);
  if (whole && known(whole[1])) return values[whole[1]];
  return text.replace(PLACEHOLDER, (match, id: string) =>
    known(id) ? String(values[id]) : match,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
