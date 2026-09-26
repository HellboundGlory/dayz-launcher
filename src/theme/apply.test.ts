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
    expect(render("light", 1)["--glow"]).not.toBe(render("dark", 1)["--glow"]);
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

  it("lights only selected controls by default", () => {
    for (const props of [propsFor(), propsFor("selected")]) {
      expect(props["--t-glow-rest"]).toBe("none");
      expect(props["--t-glow-selected"]).toBe("var(--t-shadow-glow)");
    }
  });

  it("lights controls at rest only under always, and neither under never", () => {
    const always = propsFor("always");
    expect(always["--t-glow-rest"]).toBe("var(--t-shadow-glow)");
    expect(always["--t-glow-selected"]).toBe("var(--t-shadow-glow)");

    const never = propsFor("never");
    expect(never["--t-glow-rest"]).toBe("none");
    expect(never["--t-glow-selected"]).toBe("none");
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
