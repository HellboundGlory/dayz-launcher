import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { applyTheme, DEFAULT_EXTRAS } from "./apply";
import { NEUTRAL_DARK } from "./palette";

const GLOW_DARK =
  "0 0 3px rgba(143,163,189, 0.95),0 0 8px rgba(143,163,189, 0.75),0 0 18px rgba(143,163,189, 0.5)," +
  "0 0 34px rgba(143,163,189, 0.3),0 0 60px rgba(143,163,189, 0.16)";

const GLOW_LIGHT =
  "0 0 3px rgba(143,163,189, 0.57),0 0 8px rgba(143,163,189, 0.44999999999999996)," +
  "0 0 18px rgba(143,163,189, 0.3),0 0 34px rgba(143,163,189, 0.18),0 0 60px rgba(143,163,189, 0.096)";

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
  it.each([
    { scheme: "dark" as const, glow: GLOW_DARK },
    { scheme: "light" as const, glow: GLOW_LIGHT },
  ])("at full bloom the $scheme glow is the pinned five-layer shadow", ({ scheme, glow }) => {
    const props = render(scheme, 1);
    expect(props["--bloom"]).toBe("1");
    expect(props["--glow"]).toBe(glow);
  });

  it("scales every glow radius by the bloom", () => {
    const props = render("dark", 0.5);
    expect(props["--bloom"]).toBe("0.5");
    expect(props["--glow"]).toContain("0 0 1.5px ");
    expect(props["--glow"]).toContain("0 0 30px ");
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

it("main.css first-paint colours match the default theme", () => {
  const props = render("dark", DEFAULT_EXTRAS.shadows.glowIntensity);
  const css = readFileSync(new URL("../main.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root = /@layer launcher\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const declared: Record<string, string> = {};
  for (const decl of root.split(";")) {
    const colon = decl.indexOf(":");
    if (colon > 0) declared[decl.slice(0, colon).trim()] = decl.slice(colon + 1).replace(/\s/g, "");
  }
  const expected = Object.fromEntries(
    Object.entries(props)
      .filter(([name]) => !name.startsWith("--t-"))
      .map(([name, value]) => [name, value.replace(/\s/g, "")]),
  );
  expect(declared).toMatchObject(expected);
});
