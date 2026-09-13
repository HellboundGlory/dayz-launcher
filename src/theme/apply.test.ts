/** Regression guard for folding bloom into `extras.shadows.glowIntensity`:
 * the glow output must stay byte-identical to the old standalone `bloom`
 * parameter, so a fixed glowIntensity sweeps against the legacy formula. */
import { describe, expect, it, vi } from "vitest";
import { applyTheme, DEFAULT_EXTRAS } from "./apply";
import { NEUTRAL_DARK, rgba } from "./palette";

const GLOW_STEPS = [0, 0.25, 0.5, 0.75, 1];

/** The pre-fold glow formula, kept verbatim as the expected output. */
function legacyGlow(accent: string, scheme: "dark" | "light", bloom: number): string {
  const A = (a: number) => (scheme === "light" ? a * 0.6 : a);
  const r = (px: number) => `${Math.round(px * bloom * 100) / 100}px`;
  return (
    `0 0 ${r(3)} ${rgba(accent, A(0.95))},` +
    `0 0 ${r(8)} ${rgba(accent, A(0.75))},` +
    `0 0 ${r(18)} ${rgba(accent, A(0.5))},` +
    `0 0 ${r(34)} ${rgba(accent, A(0.3))},` +
    `0 0 ${r(60)} ${rgba(accent, A(0.16))}`
  );
}

function render(scheme: "dark" | "light", glowIntensity: number): Record<string, string> {
  const props: Record<string, string> = {};
  vi.stubGlobal("document", {
    documentElement: {
      style: { setProperty: (name: string, value: string) => void (props[name] = value) },
    },
  });
  applyTheme(NEUTRAL_DARK, scheme, { ...DEFAULT_EXTRAS, shadows: { glowIntensity } });
  return props;
}

describe("glow regression across glowIntensity", () => {
  it("matches the legacy bloom formula byte-for-byte in dark mode", () => {
    for (const glowIntensity of GLOW_STEPS) {
      const props = render("dark", glowIntensity);
      expect(props["--bloom"]).toBe(String(glowIntensity));
      expect(props["--glow"]).toBe(legacyGlow(NEUTRAL_DARK.accent, "dark", glowIntensity));
    }
  });

  it("keeps the light-mode dimming factor intact", () => {
    for (const glowIntensity of GLOW_STEPS) {
      const props = render("light", glowIntensity);
      expect(props["--glow"]).toBe(legacyGlow(NEUTRAL_DARK.accent, "light", glowIntensity));
    }
    // The dimming factor is real: light mode must not equal dark mode output.
    expect(render("light", 1)["--glow"]).not.toBe(render("dark", 1)["--glow"]);
  });
});
