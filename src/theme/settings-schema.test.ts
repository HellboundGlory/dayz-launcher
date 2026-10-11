import { describe, expect, it } from "vitest";
import { substitutePlaceholders } from "./settings-schema";

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
