import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, DEFAULT_EXTRAS } from "./apply";
import { NEUTRAL_DARK, NEUTRAL_LIGHT, rgba } from "./palette";
import { NEUTRAL_TOKENS, parseTokens, resolveTokens } from "./tokens";

afterEach(() => vi.unstubAllGlobals());


describe("v2 token resolution", () => {

  it("merges nested overrides without mutating Neutral or retaining previous themes", () => {
    const tokens = resolveTokens({ colors: { dark: { accent: "#ff0000" } }, bloom: 0, scales: { type: { weight: { normal: 450 } } }, roles: { type: { body: { size: "17px" } }, radius: { row: 0 } } });
    expect(tokens.colors.dark.accent).toBe("#ff0000");
    expect(tokens.colors.dark.bg).toBe(NEUTRAL_DARK.bg);
    expect(tokens.colors.light).toEqual(NEUTRAL_LIGHT);
    expect(tokens.bloom).toBe(0);
    expect(tokens.roles.type.body).toEqual({ ...NEUTRAL_TOKENS.roles.type.body, size: "17px" });
    expect(tokens.scales.type.weight).toEqual({ ...NEUTRAL_TOKENS.scales.type.weight, normal: 450 });
    expect(tokens.roles.radius.row).toBe(0);
    tokens.roles.type.body.family = "changed";
    expect(resolveTokens()).toEqual(NEUTRAL_TOKENS);
  });

  it("rejects malformed token schemas while allowing omissions and literals", () => {
    expect(resolveTokens(parseTokens({}))).toEqual(NEUTRAL_TOKENS);
    expect(parseTokens({ schemaVersion: 2, roles: { radius: { row: "7px" } } })).toEqual({ schemaVersion: 2, roles: { radius: { row: "7px" } } });
    for (const input of [null, [], { schemaVersion: 1 }, { scales: null }, { roles: { type: { body: { weight: true } } } }, { bloom: Infinity }]) {
      expect(() => parseTokens(input)).toThrow();
    }
  });
});

it("writes resolved scale and role properties, palette derivations and bloom, then resets overrides", () => {
  const properties = new Map<string, string>();
  vi.stubGlobal("document", { documentElement: { style: { setProperty: (name: string, value: string) => properties.set(name, value) } } });
  applyTheme(NEUTRAL_DARK, "dark", DEFAULT_EXTRAS, {
    colors: { dark: { accent: "#ff0000" } }, bloom: 0,
    scales: { radius: { md: "9px" }, type: { size: { md: "15px" } }, border: { hairline: "3px" }, shadow: { glow: "none" } },
    roles: { radius: { row: "7px" }, type: { body: { weight: 450 } }, motion: { hover: { duration: "slow" } } },
  });
  expect(properties.get("--t-radius-md")).toBe("9px");
  expect(properties.get("--t-radius-control")).toBe("9px");
  expect(properties.get("--t-radius-row")).toBe("7px");
  expect(properties.get("--t-space-rowX")).toBe(String(NEUTRAL_TOKENS.scales.space[NEUTRAL_TOKENS.roles.space.rowX as keyof typeof NEUTRAL_TOKENS.scales.space]));
  expect(properties.get("--t-type-body-size")).toBe("15px");
  expect(properties.get("--t-type-body-weight")).toBe("450");
  expect(properties.get("--t-type-body-family")).toBe(NEUTRAL_TOKENS.scales.type.family.ui);
  expect(properties.get("--t-border-hairline")).toBe("3px");
  expect(properties.get("--t-shadow-glow")).toBe("none");
  expect(properties.get("--t-motion-hover-duration")).toBe("300ms");
  expect(properties.get("--t-motion-hover-easing")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
  expect(properties.get("--accent")).toBe("#ff0000");
  expect(properties.get("--accent-soft")).toBe(rgba("#ff0000", 0.16));
  expect(properties.get("--bloom")).toBe("0");
  expect(properties.get("--glow")).toContain("0 0 0px");
  expect(properties.get("--radius-control")).toBe(DEFAULT_EXTRAS.radii.control);
  applyTheme(NEUTRAL_LIGHT, "light");
  expect(properties.get("--t-radius-control")).toBe("6px");
  expect(properties.get("--t-shadow-glow")).toBe("var(--glow)");
  expect(properties.get("--accent")).toBe(NEUTRAL_LIGHT.accent);
});
