// Enumerates a theme's settings combinations for Dev Mode's switcher — pure,
// no React/DOM/store/IPC. Mirrors the Rust `extract_settings_combinations`
// (src-tauri/src/theme/validator/settings.rs) for iteration order, but pins
// every non-discrete field's default into each combination instead of
// omitting it, since these maps feed the live renderer and apply().
import type { SettingsField } from "@/theme/settings-schema";
import type { SettingsValue } from "@/theme/theme-store";

export interface SettingsCombination {
  values: Record<string, SettingsValue>;
  label: string;
}

const CAP = 64;

function discreteValues(field: SettingsField): SettingsValue[] | null {
  if (field.type === "boolean") return [false, true];
  if (field.type === "choice") return field.options.map((o) => o.value);
  return null;
}

function labelPart(id: string, value: SettingsValue): string {
  return `${id}=${typeof value === "boolean" ? (value ? "on" : "off") : value}`;
}

export function settingsCombinations(fields: SettingsField[]): {
  combinations: SettingsCombination[];
  capped: boolean;
} {
  const defaults: Record<string, SettingsValue> = {};
  for (const field of fields) defaults[field.id] = field.default;

  const discrete: { id: string; values: SettingsValue[] }[] = [];
  for (const field of fields) {
    const values = discreteValues(field);
    if (values) discrete.push({ id: field.id, values });
  }

  if (discrete.length === 0) {
    return { combinations: [{ values: defaults, label: "Defaults" }], capped: false };
  }

  let total = 1;
  for (const { values } of discrete) {
    total *= values.length;
    if (total > CAP) break;
  }
  const capped = total > CAP;
  const count = capped ? CAP : total;

  const combinations: SettingsCombination[] = [];
  for (let k = 0; k < count; k++) {
    // Mixed-radix decode: the last field is least significant (fastest
    // varying), the first field most significant (slowest) — same order the
    // Rust nested-loop expansion produces.
    let rem = k;
    const picked: SettingsValue[] = new Array(discrete.length);
    for (let i = discrete.length - 1; i >= 0; i--) {
      const size = discrete[i].values.length;
      picked[i] = discrete[i].values[rem % size];
      rem = Math.floor(rem / size);
    }
    const values = { ...defaults };
    const labelParts: string[] = [];
    for (let i = 0; i < discrete.length; i++) {
      values[discrete[i].id] = picked[i];
      labelParts.push(labelPart(discrete[i].id, picked[i]));
    }
    combinations.push({ values, label: labelParts.join(" · ") });
  }
  return { combinations, capped };
}
