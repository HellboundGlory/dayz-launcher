// Dev Mode contrast warnings (SPEC §18/§19): pure module, no React/DOM/store/IPC.
import { contrast, type Palette } from "../palette";
import type { ValidationIssue } from "@/types/theme";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isHex(v: string): boolean {
  return HEX_RE.test(v);
}

interface Pair {
  fgLabel: string;
  fg: string;
  fgPointer: string;
  bgLabel: string;
  bg: string;
}

export function contrastIssues(
  palette: Palette,
  roleColors: Record<string, string>,
  scheme: "dark" | "light",
): ValidationIssue[] {
  const colorPointer = (token: string) => `/colors/${scheme}/${token}`;
  const rolePointer = (name: string) => `/roles/color/${name}`;

  const pairs: Pair[] = [
    { fgLabel: "text", fg: palette.text, fgPointer: colorPointer("text"), bgLabel: "bg", bg: palette.bg },
    { fgLabel: "text", fg: palette.text, fgPointer: colorPointer("text"), bgLabel: "surface", bg: palette.surface },
    { fgLabel: "muted", fg: palette.muted, fgPointer: colorPointer("muted"), bgLabel: "surface", bg: palette.surface },
    { fgLabel: "onAccent", fg: roleColors.onAccent, fgPointer: rolePointer("onAccent"), bgLabel: "accent", bg: palette.accent },
    { fgLabel: "onAccent2", fg: roleColors.onAccent2, fgPointer: rolePointer("onAccent2"), bgLabel: "accent2", bg: palette.accent2 },
    { fgLabel: "onDanger", fg: roleColors.onDanger, fgPointer: rolePointer("onDanger"), bgLabel: "danger", bg: palette.danger },
    { fgLabel: "success", fg: palette.success, fgPointer: colorPointer("success"), bgLabel: "surface", bg: palette.surface },
    { fgLabel: "warn", fg: palette.warn, fgPointer: colorPointer("warn"), bgLabel: "surface", bg: palette.surface },
    { fgLabel: "danger", fg: palette.danger, fgPointer: colorPointer("danger"), bgLabel: "surface", bg: palette.surface },
  ];

  const isBodyTextPair = (fgLabel: string, bgLabel: string) =>
    fgLabel === "text" && (bgLabel === "bg" || bgLabel === "surface");

  const issues: ValidationIssue[] = [];
  for (const pair of pairs) {
    if (!isHex(pair.fg) || !isHex(pair.bg)) continue;
    const ratio = contrast(pair.fg, pair.bg);
    const errorFloor = isBodyTextPair(pair.fgLabel, pair.bgLabel);
    if (errorFloor && ratio < 3.0) {
      issues.push({
        ruleId: "TOK-05",
        severity: "error",
        file: "tokens.json",
        pointer: pair.fgPointer,
        message: `${pair.fgLabel} on ${pair.bgLabel} is ${ratio.toFixed(1)}:1 (needs 3.0:1)`,
      });
    } else if (ratio < 4.5) {
      issues.push({
        ruleId: "TOK-05",
        severity: "warning",
        file: "tokens.json",
        pointer: pair.fgPointer,
        message: `${pair.fgLabel} on ${pair.bgLabel} is ${ratio.toFixed(1)}:1 (needs 4.5:1)`,
      });
    }
  }
  return issues;
}
