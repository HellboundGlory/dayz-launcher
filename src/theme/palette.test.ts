/** Contrast regression for the light-mode auto-derive: every dark palette's
 * derived light pair must clear the 4.5:1 WCAG floor for accent/success/warn/danger. */
import { describe, expect, it } from "vitest";
import {
  contrast,
  deriveLight,
  hexToHsl,
  hsl,
  PRESETS,
  type Palette,
} from "./palette.ts";

const TARGET = 4.5;

function check(failures: string[], label: string, actual: number, fg: string, bg: string) {
  if (actual < TARGET) {
    failures.push(`${label}: ${actual.toFixed(2)} < ${TARGET} (${fg} on ${bg})`);
  }
}

// A dark palette built around a given hue, so the derive loop has to find a
// light instance for every accent-ish token.
function syntheticDark(hue: number, sat = 0.75): Palette {
  const N = (l: number, s: number) => hsl(hue, s, l);
  return {
    bg: N(0.05, 0.12),
    surface: N(0.08, 0.12),
    surface2: N(0.12, 0.12),
    border: N(0.2, 0.12),
    text: N(0.92, 0.06),
    muted: N(0.55, 0.08),
    muted2: N(0.68, 0.08),
    accent: hsl(hue, sat, 0.55),
    accent2: hsl((hue + 40) % 360, sat, 0.55),
    success: hsl((hue + 60) % 360, sat, 0.55),
    warn: hsl((hue + 120) % 360, sat, 0.55),
    danger: hsl((hue + 200) % 360, sat, 0.55),
  };
}

describe("light-mode auto-derive contrast", () => {
  it("clears the WCAG floor across a full hue sweep and keeps hue stable", () => {
    const failures: string[] = [];
    // Hue sweep, 1° steps. Each iteration runs a full deriveLight (~48
    // contrast probes per semantic token), which is still trivially fast.
    for (let hue = 0; hue < 360; hue += 1) {
      const light = deriveLight(syntheticDark(hue));
      const bg = light.bg;
      const tokens = ["accent", "accent2", "success", "warn", "danger"] as const;
      for (const t of tokens) {
        check(failures, `hue ${hue} light.${t}`, contrast(light[t], bg), light[t], bg);
      }
      // The derive keeps hue stable — the entire point of "hue preserved".
      const derivedHue = hexToHsl(light.accent)[0];
      if (Math.abs(derivedHue - hue) > 1) {
        failures.push(`hue ${hue}: derived light.accent hue ${derivedHue.toFixed(1)} drifted`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("clears the WCAG floor for every derived preset light pair", () => {
    const failures: string[] = [];
    // Neutral's light is authored (NEUTRAL_LIGHT), so it is not an output of
    // the loop under test.
    for (const p of PRESETS) {
      if (p.id === "neutral") continue;
      const light = p.light;
      const bg = light.bg;
      for (const t of ["accent", "accent2", "success", "warn", "danger"] as const) {
        check(failures, `${p.name} light.${t}`, contrast(light[t], bg), light[t], bg);
      }
    }
    expect(failures).toEqual([]);
  });
});
