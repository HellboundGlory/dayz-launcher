import { describe, expect, it, vi } from "vitest";
import { applyTheme, DEFAULT_EXTRAS } from "./apply";
import { NEUTRAL_DARK, rgba } from "./palette";

const GLOW_STEPS = [0, 0.25, 0.5, 0.75, 1];

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
  it.each(GLOW_STEPS)("bloom %s: --bloom and --glow follow the legacy dark formula", (glowIntensity) => {
    const props = render("dark", glowIntensity);
    expect(props["--bloom"]).toBe(String(glowIntensity));
    expect(props["--glow"]).toBe(legacyGlow(NEUTRAL_DARK.accent, "dark", glowIntensity));
  });

  it.each(GLOW_STEPS)("bloom %s: the light-mode glow keeps its dimming factor", (glowIntensity) => {
    const light = render("light", glowIntensity);
    expect(light["--glow"]).toBe(legacyGlow(NEUTRAL_DARK.accent, "light", glowIntensity));
    expect(light["--glow"]).not.toBe(render("dark", glowIntensity)["--glow"]);
  });
});

describe("glow policy CSS custom properties", () => {
  function propsFor(glow?: "always" | "selected" | "never"): Record<string, string> {
    const props: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: {
        style: { setProperty: (name: string, value: string) => void (props[name] = value) },
      },
    });
    applyTheme(NEUTRAL_DARK, "dark", DEFAULT_EXTRAS, glow === undefined ? undefined : { schemaVersion: 2, glow });
    return props;
  }

  const GLOW = "var(--t-shadow-glow)";

  it.each<[string, "always" | "selected" | "never" | undefined, string, string]>([
    ["nothing", undefined, "none", GLOW],
    ["'selected'", "selected", "none", GLOW],
    ["'always'", "always", GLOW, GLOW],
    ["'never'", "never", "none", "none"],
  ])("writes --t-glow-* for a theme that declares %s", (_policy, glow, rest, selected) => {
    const props = propsFor(glow);

    expect(props["--t-glow-rest"]).toBe(rest);
    expect(props["--t-glow-selected"]).toBe(selected);
  });
});

describe("settingsValues CSS custom properties", () => {
  it("writes --setting-<id> custom properties onto documentElement style", () => {
    const props: Record<string, string> = {};
    vi.stubGlobal("document", {
      documentElement: {
        style: { setProperty: (name: string, value: string) => void (props[name] = value) },
      },
    });
    applyTheme(NEUTRAL_DARK, "dark", DEFAULT_EXTRAS, undefined, {
      accentHue: 210,
      compactRows: true,
      fontMode: "sans",
      primaryColor: "#ff0000",
    });

    expect(props["--setting-accentHue"]).toBe("210");
    expect(props["--setting-compactRows"]).toBe("true");
    expect(props["--setting-fontMode"]).toBe("sans");
    expect(props["--setting-primaryColor"]).toBe("#ff0000");
  });
});
