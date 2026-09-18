import { describe, expect, it } from "vitest";
import { settingsCombinations } from "./combinations";
import type { SettingsField } from "@/theme/settings-schema";

const boolField = (id: string, label = id): SettingsField => ({
  id,
  type: "boolean",
  label,
  default: false,
});

const numberField = (id: string, def = 5): SettingsField => ({
  id,
  type: "number",
  label: id,
  min: 0,
  max: 10,
  default: def,
});

const colorField = (id: string, def = "#112233"): SettingsField => ({
  id,
  type: "color",
  label: id,
  default: def,
});

const choiceField = (id: string, options: string[], def = options[0]): SettingsField => ({
  id,
  type: "choice",
  label: id,
  options: options.map((value) => ({ value, label: value })),
  default: def,
});

describe("settingsCombinations", () => {
  it("expands two booleans into four combinations, first field slowest", () => {
    const { combinations, capped } = settingsCombinations([boolField("compact"), boolField("dense")]);
    expect(capped).toBe(false);
    expect(combinations.map((c) => c.values)).toEqual([
      { compact: false, dense: false },
      { compact: false, dense: true },
      { compact: true, dense: false },
      { compact: true, dense: true },
    ]);
  });

  it("multiplies a three-option choice field correctly", () => {
    const { combinations } = settingsCombinations([choiceField("density", ["cosy", "regular", "compact"])]);
    expect(combinations.map((c) => c.values.density)).toEqual(["cosy", "regular", "compact"]);
  });

  it("pins number and color fields at their default in every combination without multiplying the count", () => {
    const { combinations } = settingsCombinations([
      boolField("compact"),
      numberField("scale", 7),
      colorField("accent", "#ff00ff"),
    ]);
    expect(combinations).toHaveLength(2);
    for (const c of combinations) {
      expect(c.values.scale).toBe(7);
      expect(c.values.accent).toBe("#ff00ff");
    }
  });

  it("yields one 'Defaults' combination for a schema with no discrete fields", () => {
    const { combinations, capped } = settingsCombinations([numberField("scale", 3), colorField("accent")]);
    expect(capped).toBe(false);
    expect(combinations).toEqual([{ values: { scale: 3, accent: "#112233" }, label: "Defaults" }]);
  });

  it("yields one 'Defaults' combination for an empty fields array", () => {
    expect(settingsCombinations([])).toEqual({
      combinations: [{ values: {}, label: "Defaults" }],
      capped: false,
    });
  });

  it("labels combinations from the discrete fields only, booleans as on/off", () => {
    const { combinations } = settingsCombinations([
      boolField("compact"),
      choiceField("density", ["cosy", "regular"]),
      numberField("scale"),
    ]);
    expect(combinations.map((c) => c.label)).toEqual([
      "compact=off · density=cosy",
      "compact=off · density=regular",
      "compact=on · density=cosy",
      "compact=on · density=regular",
    ]);
  });

  it("caps a product above 64 at exactly 64 combinations, flagged capped", () => {
    // 3 * 3 * 3 * 3 = 81 > 64
    const fields = [
      choiceField("a", ["1", "2", "3"]),
      choiceField("b", ["1", "2", "3"]),
      choiceField("c", ["1", "2", "3"]),
      choiceField("d", ["1", "2", "3"]),
    ];
    const { combinations, capped } = settingsCombinations(fields);
    expect(capped).toBe(true);
    expect(combinations).toHaveLength(64);
    expect(combinations[0].values).toEqual({ a: "1", b: "1", c: "1", d: "1" });
  });
});
