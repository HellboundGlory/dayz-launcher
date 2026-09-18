// Resolves theme settings.schema.json and substitutes user-tuned settings values.
export interface SettingsIssue {
  slotId: string;
  message: string;
}

export type SettingsField =
  | { id: string; type: "number"; label: string; min: number; max: number; step?: number; default: number }
  | { id: string; type: "boolean"; label: string; default: boolean }
  | { id: string; type: "choice"; label: string; options: { value: string; label: string }[]; default: string }
  | { id: string; type: "color"; label: string; default: string };

const FIELD_ID_REGEX = /^[a-z][a-zA-Z0-9]{0,31}$/;
const OPTION_VALUE_REGEX = /^[a-z0-9-]+$/;
const COLOR_HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

export function resolveSettingsSchema(schemaJson: unknown): {
  fields: SettingsField[];
  issues: SettingsIssue[];
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
  const issues: SettingsIssue[] = [];
  const seenIds = new Set<string>();

  for (const entry of schemaJson.fields) {
    const field = readField(entry, issues, seenIds);
    if (field) {
      seenIds.add(field.id);
      fields.push(field);
    }
  }
  return { fields, issues };
}

function readField(
  entry: unknown,
  issues: SettingsIssue[],
  seenIds: Set<string>,
): SettingsField | null {
  if (!isPlainObject(entry)) {
    issues.push({ slotId: "", message: `a field entry is not an object ('${describe(entry)}')` });
    return null;
  }

  const { id, type, label, default: fallback, min, max, step, options } = entry;
  const where = typeof id === "string" && id !== "" ? id : "";
  const fail = (reason: string): null => {
    issues.push({ slotId: where, message: `field '${describe(id)}' ${reason}` });
    return null;
  };

  if (typeof id !== "string" || id === "") return fail("has no string `id`");
  if (!FIELD_ID_REGEX.test(id)) return fail("has invalid id format");
  if (seenIds.has(id)) return fail("has duplicate id");

  if (typeof label !== "string" || label === "" || label.length > 40) return fail("has no string `label`");

  if (type === "number") {
    if (typeof fallback !== "number") return fail("declares `type: \"number\"` but no numeric `default`");
    if (typeof min !== "number" || typeof max !== "number") {
      return fail("declares `type: \"number\"` but no numeric `min`/`max`");
    }
    if (min > max) return fail(`has min ${min} above max ${max}`);
    if (step !== undefined && (typeof step !== "number" || step <= 0)) {
      return fail("declares invalid `step`");
    }
    return { id, type, label, min, max, ...(step !== undefined ? { step } : {}), default: fallback };
  }

  if (type === "boolean") {
    if (typeof fallback !== "boolean") {
      return fail("declares `type: \"boolean\"` but no boolean `default`");
    }
    return { id, type, label, default: fallback };
  }

  if (type === "choice") {
    if (!Array.isArray(options) || options.length < 2) {
      return fail("declares `type: \"choice\"` but needs at least two options");
    }
    const optionValues = new Set<string>();
    const parsedOptions: { value: string; label: string }[] = [];
    for (const opt of options) {
      if (!isPlainObject(opt)) return fail("has invalid option item");
      const { value: val, label: lbl } = opt;
      if (typeof val !== "string" || !OPTION_VALUE_REGEX.test(val)) return fail("has invalid option value");
      if (typeof lbl !== "string" || lbl === "" || lbl.length > 40) return fail("has invalid option label");
      if (optionValues.has(val)) return fail("has duplicate option value");
      optionValues.add(val);
      parsedOptions.push({ value: val, label: lbl });
    }
    if (typeof fallback !== "string" || !optionValues.has(fallback)) {
      return fail("has default not matching any option");
    }
    return { id, type, label, options: parsedOptions, default: fallback };
  }

  if (type === "color") {
    if (typeof fallback !== "string" || !COLOR_HEX_REGEX.test(fallback)) {
      return fail("declares `type: \"color\"` but invalid hex `default`");
    }
    return { id, type, label, default: fallback };
  }

  return fail(`has unknown type '${describe(type)}'`);
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

function describe(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}
