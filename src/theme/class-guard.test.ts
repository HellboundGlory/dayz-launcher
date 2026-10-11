import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

// A colour is a var() string, so an opacity modifier compiles to a different
// colour than the derived alpha token, and a class naming a key that does not
// exist generates nothing either.
const themeBlock = /@theme inline \{([^}]*)\}/.exec(readFileSync(join(SRC, "main.css"), "utf8"))?.[1] ?? "";
const colorKeys = [...themeBlock.matchAll(/--color-([a-z0-9-]+):/g)].map((match) => match[1]);
const opacityModifier = new RegExp(`-(${colorKeys.join("|")})/(\\d|\\[)`);
const BANNED = ["border-border", "text-text", "bg-background", "text-foreground", "ring-ring", "hsl(var("];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(tsx?|css)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return path;
  });
}

function isOffending(text: string): boolean {
  return opacityModifier.test(text) || BANNED.some((name) => text.includes(name));
}

const RAW_VALUE_SKIPPED = [
  "src/theme/tokens.ts",
  "src/theme/apply.ts",
  "src/theme/palette.ts",
  "src/main.css",
  "src/splash.tsx",
  "src/splash.css",
  "src/components/splash-screen.tsx",
  "src/components/themes-page/DevMode",
  "src/theme/dev/",
  "src/theme/elements/mod-thumbnail.tsx",
];
const RAW_COLOUR =
  /(?<![&\w])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])|(?<![\w-])(?:rgba?|hsla?)\(|(?<![\w-])(?:bg|text|border|border-[xytrblse]|divide|ring|ring-offset|inset-ring|shadow|inset-shadow|drop-shadow|text-shadow|fill|stroke|from|to|via|outline|decoration|accent|caret|placeholder)-(?:black|white)(?![\w-])/;
const STACKING = /(?<![\w-])z-(?:\[(\d+)\]|(\d+))(?![\w-])|z-index:\s*(\d+)|zIndex:\s*["']?(\d+)/g;

function isRawValue(line: string): boolean {
  return RAW_COLOUR.test(line) || [...line.matchAll(STACKING)].some((match) => Number(match[1] ?? match[2] ?? match[3] ?? match[4]) > 10);
}

const repoPath = (file: string) => relative(process.cwd(), file).split(sep).join("/");

function offendingLines(files: string[], isBad: (line: string) => boolean): string[] {
  return files.flatMap((file) => {
    const path = repoPath(file);
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (isBad(line) ? [`${path}:${index + 1} ${line.trim()}`] : []));
  });
}

describe("token utility guard", () => {
  it("has no class that Tailwind would drop", () => {
    expect(colorKeys.length).toBeGreaterThan(0);
    expect(offendingLines([...sourceFiles(SRC), join(process.cwd(), "index.html")], isOffending)).toEqual([]);
  });

  it("has no raw colour or stacking number outside the token sources", () => {
    const files = sourceFiles(SRC).filter((file) => !RAW_VALUE_SKIPPED.some((prefix) => repoPath(file).startsWith(prefix)));
    expect(offendingLines(files, isRawValue)).toEqual([]);
  });
});
