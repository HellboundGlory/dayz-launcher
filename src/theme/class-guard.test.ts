import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error tailwind.config.js is plain JS, so it carries no types.
import tailwindConfig from "../../tailwind.config.js";

const SRC = join(process.cwd(), "src");

// Tailwind colours are var() strings, so an opacity modifier generates no rule,
// and a class naming a colour key that does not exist generates nothing either.
const colorKeys = Object.keys(tailwindConfig.theme.extend.colors);
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

describe("token utility guard", () => {
  it("has no class that Tailwind would drop", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(SRC), join(process.cwd(), "index.html")]) {
      const text = readFileSync(file, "utf8");
      if (!isOffending(text)) continue;
      text.split("\n").forEach((line, index) => {
        if (isOffending(line)) offenders.push(`${relative(process.cwd(), file)}:${index + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
