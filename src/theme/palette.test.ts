/**
 * Contrast regression for the light-mode auto-derive (handoff §5, PLAN §3.4).
 *
 * The invariant the design locks: **any** dark palette's derived light pair has
 * accent/success/warn/danger clearing the 4.5:1 WCAG floor against the derived
 * `light.bg`. Muted text is deliberately dimmer (authored values, not part of
 * the floor), and the dark palettes themselves are authored — the loop is the
 * thing under test.
 *
 * Runnable with plain Node (no test runner in this repo):
 *   node src/theme/palette.test.ts
 */
import {
  contrast,
  deriveLight,
  hexToHsl,
  hsl,
  PRESETS,
  type Palette,
} from "./palette.ts";

const TARGET = 4.5;
let failures = 0;

function check(label: string, actual: number, fg: string, bg: string) {
  if (actual < TARGET) {
    failures += 1;
    console.error(`FAIL ${label}: ${actual.toFixed(2)} < ${TARGET} (${fg} on ${bg})`);
  }
}

// A plausible dark palette built around a given hue: every accent-ish token
// sits on that hue so the derive loop has to find a light instance for each.
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

// Hue sweep, 1° steps. Each iteration runs a full deriveLight (~48 contrast
// probes per semantic token), which is still trivially fast in Node.
for (let hue = 0; hue < 360; hue += 1) {
  const light = deriveLight(syntheticDark(hue));
  const bg = light.bg;
  const tokens = ["accent", "accent2", "success", "warn", "danger"] as const;
  for (const t of tokens) {
    check(`hue ${hue} light.${t}`, contrast(light[t], bg), light[t], bg);
  }
  // The derive keeps hue stable — the entire point of "hue preserved".
  const derivedHue = hexToHsl(light.accent)[0];
  if (Math.abs(derivedHue - hue) > 1) {
    failures += 1;
    console.error(`FAIL hue ${hue}: derived light.accent hue ${derivedHue.toFixed(1)} drifted`);
  }
}

// The five derived preset light pairs must pass outright. Neutral's light is
// authored (NEUTRAL_LIGHT), so it is not an output of the loop under test.
for (const p of PRESETS) {
  if (p.id === "neutral") continue;
  const light = p.light;
  const bg = light.bg;
  for (const t of ["accent", "accent2", "success", "warn", "danger"] as const) {
    check(`${p.name} light.${t}`, contrast(light[t], bg), light[t], bg);
  }
}

if (failures > 0) {
  console.error(`\n${failures} contrast failure(s)`);
  throw new Error(`${failures} contrast failure(s)`);
}
console.log(
  `OK: hue sweep 0–359 + all derived preset lights clear ${TARGET}:1 on their light.bg`,
);
