import { __unstable__loadDesignSystem } from "@tailwindcss/node";
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
  "src/components/splash-screen.tsx",
  "src/components/themes-page/dev-mode-",
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

/** Text between the bracket at `open` and its match, string contents skipped. */
function bracketBody(text: string, open: number): string {
  const [opener, closer] = text[open] === "{" ? ["{", "}"] : ["(", ")"];
  let depth = 1;
  let quote = "";
  let i = open + 1;
  for (; i < text.length && depth > 0; i++) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === opener) {
      depth++;
    } else if (char === closer) {
      depth--;
    }
  }
  return text.slice(open + 1, i - 1);
}

// Tailwind emits neither: theme-trigger is the visual harness's click target, and group/peer
// (bare or named) are variant markers.
const ALLOWED_CLASSES = new Set(["theme-trigger"]);
const VARIANT_MARKER = /^(group|peer)(\/|$)/;

/** Every class string a file hands to Tailwind, with the line it sits on. */
function classTokens(file: string): [string, number][] {
  const text = readFileSync(file, "utf8");
  const lineOf = (at: number) => text.slice(0, at).split("\n").length;
  const tokens: [string, number][] = [];
  const push = (at: number, chunk: string) => {
    for (const token of chunk.split(/\s+/)) if (token) tokens.push([token, lineOf(at)]);
  };
  // Quoted literals in a code span; `x === "failed"` is a comparison, not a class.
  const pushLiterals = (at: number, code: string) => {
    for (const literal of code.matchAll(/"([^"]*)"|'([^']*)'/g)) {
      if (/[=!]$/.test(code.slice(0, literal.index).trimEnd())) continue;
      push(at + (literal.index ?? 0), literal[1] ?? literal[2]);
    }
  };

  for (const match of text.matchAll(/className="([^"]*)"/g)) push(match.index ?? 0, match[1]);
  // Defaults (`className ?? "…"`), ternaries and the like.
  for (const match of text.matchAll(/className=\{(?!`)/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    pushLiterals(open + 1, bracketBody(text, open));
  }
  for (const match of text.matchAll(/className=\{`([^`]*)`\}/g)) {
    const at = match.index ?? 0;
    push(at, match[1].replace(/\$\{[^}]*\}/g, " "));
    for (const part of match[1].matchAll(/\$\{([^}]*)\}/g)) pushLiterals(at, part[1]);
  }
  for (const match of text.matchAll(/const [A-Z][A-Z0-9_]*(?:_CLASS|_BTN)[A-Z0-9_]* =[ \t]*\n?[ \t]*"([^"]*)"/g)) {
    push(match.index ?? 0, match[1]);
  }
  const PROP = /\b(?:cls|dotClass|labelClass|className|defaultClass):[ \t]*\n?[ \t]*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of text.matchAll(PROP)) push(match.index ?? 0, match[1] ?? match[2]);
  for (const match of text.matchAll(/\b(?:cn|clsx)\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    pushLiterals(open + 1, bracketBody(text, open));
  }
  return tokens;
}

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

  it("has no class token Tailwind can't build", async () => {
    const design = await __unstable__loadDesignSystem(readFileSync(join(SRC, "main.css"), "utf8"), { base: SRC });
    const files = sourceFiles(SRC);
    // theme-guard.html carries its own inline sheet.
    const selectors = new Set(
      [...files.filter((file) => file.endsWith(".css")), join(process.cwd(), "theme-guard.html")].flatMap((file) =>
        [...readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|"[^"]*"|'[^']*'/g, "").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(
          (match) => match[1],
        ),
      ),
    );

    const found = new Map<string, string>();
    for (const file of files.filter((file) => /\.tsx?$/.test(file))) {
      for (const [token, line] of classTokens(file)) {
        if (!found.has(token)) found.set(token, `${repoPath(file)}:${line}`);
      }
    }

    const tokens = [...found.keys()];
    const built = design.candidatesToCss(tokens);
    const dead = tokens.flatMap((token, index) => {
      if (built[index] !== null || selectors.has(token) || ALLOWED_CLASSES.has(token) || VARIANT_MARKER.test(token)) {
        return [];
      }
      return [`${found.get(token)} ${token}`];
    });
    expect(dead).toEqual([]);
  });
});
