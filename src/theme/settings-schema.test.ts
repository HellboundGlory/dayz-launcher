import { describe, expect, it } from "vitest";
import { resolveSettingsSchema, substitutePlaceholders } from "./settings-schema";

const schema = (fields: unknown[]) => ({ schemaVersion: 1, fields });

const hue = {
  id: "accentHue",
  type: "number",
  label: "Accent hue",
  min: 0,
  max: 360,
  step: 1,
  default: 210,
};
const compact = { id: "compactRows", type: "boolean", label: "Compact server rows", default: false };
const mode = {
  id: "fontMode",
  type: "choice",
  label: "Font Mode",
  options: [
    { value: "sans", label: "Sans-Serif" },
    { value: "mono", label: "Monospace" },
  ],
  default: "sans",
};
const primaryColor = {
  id: "primaryColor",
  type: "color",
  label: "Primary Color",
  default: "#123456",
};

describe("resolveSettingsSchema", () => {
  it("reads all 4 field types, preserving file order and properties", () => {
    const { fields, issues } = resolveSettingsSchema(schema([hue, compact, mode, primaryColor]));

    expect(fields).toEqual([hue, compact, mode, primaryColor]);
    expect(issues).toEqual([]);
  });

  it("drops only the field with an unknown type, keeping the rest", () => {
    const { fields, issues } = resolveSettingsSchema(
      schema([hue, { id: "unknownField", type: "unknownType", label: "Unknown", default: "foo" }, compact]),
    );

    expect(fields.map((field) => field.id)).toEqual(["accentHue", "compactRows"]);
    expect(issues).toEqual([{ slotId: "unknownField", message: "field 'unknownField' has unknown type 'unknownType'" }]);
  });

  it("drops a field with duplicate id", () => {
    const { fields, issues } = resolveSettingsSchema(
      schema([hue, { ...hue, label: "Duplicate hue" }]),
    );

    expect(fields).toEqual([hue]);
    expect(issues).toEqual([{ slotId: "accentHue", message: "field 'accentHue' has duplicate id" }]);
  });

  it("drops a choice field with invalid options or default", () => {
    const { fields, issues } = resolveSettingsSchema(
      schema([{ id: "badChoice", type: "choice", label: "Bad", options: [{ value: "one", label: "One" }], default: "one" }]),
    );

    expect(fields).toEqual([]);
    expect(issues).toEqual([{ slotId: "badChoice", message: "field 'badChoice' declares `type: \"choice\"` but needs at least two options" }]);
  });

  it("drops a color field with invalid hex default", () => {
    const { fields, issues } = resolveSettingsSchema(
      schema([{ id: "badColor", type: "color", label: "Bad Color", default: "blue" }]),
    );

    expect(fields).toEqual([]);
    expect(issues).toEqual([{ slotId: "badColor", message: "field 'badColor' declares `type: \"color\"` but invalid hex `default`" }]);
  });

  it("drops a number field whose min is above its max", () => {
    const { fields, issues } = resolveSettingsSchema(
      schema([{ ...hue, min: 360, max: 0 }, compact]),
    );

    expect(fields.map((field) => field.id)).toEqual(["compactRows"]);
    expect(issues).toEqual([{ slotId: "accentHue", message: "field 'accentHue' has min 360 above max 0" }]);
  });

  it.each([
    ["a missing fields key", { schemaVersion: 1 }],
    ["fields not an array", { schemaVersion: 1, fields: "accentHue" }],
    ["a non-object schema", "settings.schema.json"],
    ["null", null],
  ])("treats %s as one issue and no fields", (_label, json) => {
    const { fields, issues } = resolveSettingsSchema(json);

    expect(fields).toEqual([]);
    expect(issues).toEqual([
      { slotId: "", message: "settings.schema.json must be a JSON object with a `fields` array" },
    ]);
  });

  it.each([
    ["no id", { type: "boolean", label: "Compact", default: false }],
    ["no label", { id: "compactRows", type: "boolean", default: false }],
    ["a number field with no min/max", { id: "accentHue", type: "number", label: "Hue", default: 210 }],
    ["a boolean field whose default is a number", { ...compact, default: 1 }],
    ["a string default on a number field", { ...hue, default: "210" }],
    ["a non-object entry", "accentHue"],
  ])("drops an entry with %s, with an issue", (_label, entry) => {
    const { fields, issues } = resolveSettingsSchema(schema([entry]));

    expect(fields).toEqual([]);
    expect(issues).toHaveLength(1);
  });
});

describe("substitutePlaceholders", () => {
  it("returns a whole-string placeholder as the value's typed form, not its text", () => {
    const values = { accentHue: 210, compactRows: true, fontMode: "sans" };

    expect(substitutePlaceholders({ density: "{{compactRows}}" }, values)).toEqual({
      density: true,
    });
    expect(substitutePlaceholders({ hue: "{{accentHue}}" }, values)).toEqual({ hue: 210 });
    expect(substitutePlaceholders({ font: "{{fontMode}}" }, values)).toEqual({ font: "sans" });
  });

  it("substitutes a placeholder embedded in a larger string", () => {
    const result = substitutePlaceholders(
      { colors: { accent: "hsl({{accentHue}}, 45%, 60%)" } },
      { accentHue: 210 },
    );

    expect(result).toEqual({ colors: { accent: "hsl(210, 45%, 60%)" } });
  });

  it("substitutes several fragments in one string", () => {
    const result = substitutePlaceholders("{{a}}px solid {{color}}", { a: 2, color: "#ff0000" });

    expect(result).toBe("2px solid #ff0000");
  });

  it("leaves an unknown placeholder literal, whole-string and fragment alike", () => {
    const values = { accentHue: 210 };

    expect(substitutePlaceholders({ hue: "{{missing}}" }, values)).toEqual({ hue: "{{missing}}" });
    expect(substitutePlaceholders("hsl({{missing}}, 45%, 60%)", values)).toBe(
      "hsl({{missing}}, 45%, 60%)",
    );
  });

  it("walks nested objects and arrays without mutating the input", () => {
    const input = { spacing: ["{{accentHue}}px", { deep: "{{accentHue}}" }], count: 3 };

    const result = substitutePlaceholders(input, { accentHue: 8 });

    expect(result).toEqual({ spacing: ["8px", { deep: 8 }], count: 3 });
    expect(input).toEqual({ spacing: ["{{accentHue}}px", { deep: "{{accentHue}}" }], count: 3 });
  });

  it("returns a value with no placeholders unchanged", () => {
    const input = { colors: { bg: "#0d0f13" }, nested: [1, true, null] };

    expect(substitutePlaceholders(input, {})).toEqual(input);
  });

  it("does not treat a value key as a field id prefix or suffix", () => {
    expect(substitutePlaceholders("{{accent}}", { accentHue: 210 })).toBe("{{accent}}");
  });
});
