import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
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

describe("token utility guard", () => {
  it("has no class that Tailwind would drop", () => {
    expect(colorKeys.length).toBeGreaterThan(0);
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
