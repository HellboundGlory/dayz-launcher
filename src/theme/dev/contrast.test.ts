import { describe, expect, it } from "vitest";
import { contrastIssues } from "./contrast";
import type { Palette } from "../palette";

const GOOD_PALETTE: Palette = {
  bg: "#ffffff",
  surface: "#ffffff",
  surface2: "#ffffff",
  border: "#ffffff",
  text: "#000000",
  muted: "#595959",
  muted2: "#595959",
  accent: "#003366",
  accent2: "#003366",
  success: "#004d00",
  warn: "#665500",
  danger: "#660000",
};

const GOOD_ROLES: Record<string, string> = {
  onAccent: "#ffffff",
  onAccent2: "#ffffff",
  onDanger: "#ffffff",
  onSuccess: "#ffffff",
  focusRing: "var(--accent-line)",
  scrim: "rgba(5,8,13,0.7)",
  rowHover: "var(--row-hover)",
  rowSelected: "var(--row-selected)",
};

describe("contrastIssues", () => {
  it("returns no issues when every pair clears 4.5:1", () => {
    expect(contrastIssues(GOOD_PALETTE, GOOD_ROLES, "dark")).toEqual([]);
  });

  it("flags a failing text/bg pair as an error", () => {
    const palette: Palette = { ...GOOD_PALETTE, text: "#464646", bg: "#0d0f13" };
    const issues = contrastIssues(palette, GOOD_ROLES, "dark");
    expect(issues).toContainEqual({
      ruleId: "TOK-05",
      severity: "error",
      file: "tokens.json",
      pointer: "/colors/dark/text",
      message: "text on bg is 2.0:1 (needs 3.0:1)",
    });
  });

  it("flags a pair between 3.0 and 4.5 as a warning, not an error", () => {
    const palette: Palette = { ...GOOD_PALETTE, muted: "#808080" };
    const issues = contrastIssues(palette, GOOD_ROLES, "dark");
    const mutedIssue = issues.find((i) => i.pointer === "/colors/dark/muted");
    expect(mutedIssue).toEqual({
      ruleId: "TOK-05",
      severity: "warning",
      file: "tokens.json",
      pointer: "/colors/dark/muted",
      message: "muted on surface is 3.9:1 (needs 4.5:1)",
    });
  });

  it("skips a role colour that isn't a parseable hex value, without throwing", () => {
    const roles: Record<string, string> = {
      ...GOOD_ROLES,
      onAccent: "var(--accent-line)",
      onAccent2: "rgba(5,8,13,0.7)",
    };
    expect(() => contrastIssues(GOOD_PALETTE, roles, "dark")).not.toThrow();
    const issues = contrastIssues(GOOD_PALETTE, roles, "dark");
    expect(issues.find((i) => i.pointer === "/roles/color/onAccent")).toBeUndefined();
    expect(issues.find((i) => i.pointer === "/roles/color/onAccent2")).toBeUndefined();
  });

  it("reflects the scheme argument in palette pointers", () => {
    const palette: Palette = { ...GOOD_PALETTE, text: "#464646", bg: "#0d0f13" };
    const issues = contrastIssues(palette, GOOD_ROLES, "light");
    expect(issues.some((i) => i.pointer === "/colors/light/text")).toBe(true);
  });
});
