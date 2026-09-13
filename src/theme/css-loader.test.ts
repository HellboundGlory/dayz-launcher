/** Stylesheet `<link>` lifecycle and `FontFace` load/unload across theme
 * switches. Runs against a hand-rolled DOM/FontFace stub: the project's vitest
 * environment is `node`, and this module only touches a narrow slice of it. */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The two entry points under test. Declared here because `beforeEach` re-imports
 * the module fresh (see below), which a static import binding cannot follow. */
interface CssLoader {
  applyThemeStylesheet: (themeId: string | null, capabilities: string[]) => void;
  applyThemeFonts: (
    themeId: string | null,
    customFonts: { family: string; file: string }[],
  ) => void;
}

interface FakeElement {
  attributes: Record<string, string>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
}

class FakeFontFace {
  /** Every face constructed since the last `reset`, in order. */
  static instances: FakeFontFace[] = [];
  /** Families whose `load()` rejects with a 404. */
  static failing = new Set<string>();
  /** Families whose `load()` stays pending until `releaseDeferred()` is called. */
  static deferred = new Set<string>();
  static pendingLoads: (() => void)[] = [];

  family: string;
  source: string;

  constructor(family: string, source: string) {
    this.family = family;
    this.source = source;
    FakeFontFace.instances.push(this);
  }

  load(): Promise<FakeFontFace> {
    if (FakeFontFace.deferred.has(this.family)) {
      return new Promise<FakeFontFace>((resolve) => {
        FakeFontFace.pendingLoads.push(() => resolve(this));
      });
    }
    if (FakeFontFace.failing.has(this.family)) return Promise.reject(new Error("404"));
    return Promise.resolve(this);
  }

  static reset(): void {
    FakeFontFace.instances = [];
    FakeFontFace.failing = new Set();
    FakeFontFace.deferred = new Set();
    FakeFontFace.pendingLoads = [];
  }

  static releaseDeferred(): void {
    for (const resolve of FakeFontFace.pendingLoads.splice(0)) resolve();
  }
}

interface FakeFonts {
  added: unknown[];
  deleted: unknown[];
  add: (face: unknown) => void;
  delete: (face: unknown) => void;
}

interface FakeHead {
  appendChild: (el: FakeElement) => void;
}

interface FakeDocument {
  head: FakeHead;
  fonts: FakeFonts;
  getElementById: (id: string) => FakeElement | null;
  createElement: (tag: string) => FakeElement;
}

let head: FakeElement[];
let fonts: FakeFonts;
let applyThemeStylesheet: CssLoader["applyThemeStylesheet"];
let applyThemeFonts: CssLoader["applyThemeFonts"];

beforeEach(async () => {
  // Module-level state (the loaded-font list) must not leak between tests.
  vi.resetModules();
  FakeFontFace.reset();

  head = [];
  fonts = {
    added: [],
    deleted: [],
    add(face: unknown) {
      fonts.added.push(face);
    },
    delete(face: unknown) {
      fonts.deleted.push(face);
    },
  };
  const document: FakeDocument = {
    head: { appendChild: (el) => void head.push(el) },
    fonts,
    getElementById: (id) => head.find((el) => el.getAttribute("id") === id) ?? null,
    createElement: () => {
      const el: FakeElement = {
        attributes: {},
        getAttribute: (name) => el.attributes[name] ?? null,
        setAttribute: (name, value) => void (el.attributes[name] = value),
        remove: () => void head.splice(head.indexOf(el), 1),
      };
      return el;
    },
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("FontFace", FakeFontFace);

  // Intentional module-loading boundary: `css-loader` keeps the loaded-font
  // list in module scope, so each test needs a fresh instance.
  const mod = (await import("./css-loader")) as CssLoader;
  applyThemeStylesheet = mod.applyThemeStylesheet;
  applyThemeFonts = mod.applyThemeFonts;
});

/** Two microtask turns: enough for a `load()` chain to settle. */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("applyThemeStylesheet", () => {
  it("adds one stylesheet link for a css-capable theme", () => {
    applyThemeStylesheet("aurora", ["tokens", "css"]);

    expect(head).toHaveLength(1);
    expect(head[0].attributes).toMatchObject({
      id: "tetra-theme-css",
      rel: "stylesheet",
      href: "tetra-theme://aurora/styles.css",
    });
  });

  it("does nothing for a theme without the css capability", () => {
    applyThemeStylesheet("aurora", ["tokens", "fonts"]);

    expect(head).toHaveLength(0);
  });

  it("removes the link when switching to a theme without css, and restores it on switch back", () => {
    applyThemeStylesheet("aurora", ["css"]);
    expect(head).toHaveLength(1);

    applyThemeStylesheet("plain", ["tokens"]);
    expect(head).toHaveLength(0);

    applyThemeStylesheet("aurora", ["css"]);
    expect(head).toHaveLength(1);
    expect(head[0].attributes.href).toBe("tetra-theme://aurora/styles.css");
  });

  it("updates the existing link in place when the theme id changes", () => {
    applyThemeStylesheet("aurora", ["css"]);
    const first = head[0];

    applyThemeStylesheet("borealis", ["css"]);

    expect(head).toHaveLength(1);
    expect(head[0]).toBe(first);
    expect(first.attributes.href).toBe("tetra-theme://borealis/styles.css");
  });

  it("removes the link when no theme is active", () => {
    applyThemeStylesheet("aurora", ["css"]);

    applyThemeStylesheet(null, []);

    expect(head).toHaveLength(0);
  });

  it("is idempotent when re-called with the same arguments", () => {
    applyThemeStylesheet("aurora", ["css"]);
    applyThemeStylesheet("aurora", ["css"]);
    applyThemeStylesheet("aurora", ["css"]);

    expect(head).toHaveLength(1);
  });
});

describe("applyThemeFonts", () => {
  const FONTS = [
    { family: "Aurora Sans", file: "fonts/aurora.woff2" },
    { family: "Aurora Mono", file: "fonts/aurora mono.woff2" },
  ];

  it("loads and registers each declared font", async () => {
    applyThemeFonts("aurora", FONTS);
    await settled();

    expect(FakeFontFace.instances.map((f) => f.source)).toEqual([
      "url(tetra-theme://aurora/fonts/aurora.woff2)",
      "url(tetra-theme://aurora/fonts/aurora%20mono.woff2)",
    ]);
    expect(fonts.added).toEqual(FakeFontFace.instances);
  });

  it("unloads the previous theme's fonts before adding the new set", async () => {
    applyThemeFonts("aurora", FONTS);
    await settled();
    const previous = [...FakeFontFace.instances];

    applyThemeFonts("borealis", [FONTS[0]]);
    await settled();

    expect(fonts.deleted).toEqual(previous);
    expect(fonts.added).toEqual([...previous, FakeFontFace.instances[2]]);
  });

  it("unloads everything when no theme is active", async () => {
    applyThemeFonts("aurora", FONTS);
    await settled();

    applyThemeFonts(null, []);
    await settled();

    expect(fonts.deleted).toEqual(FakeFontFace.instances);
    expect(fonts.added).toHaveLength(FONTS.length);
  });

  it("skips a font that fails to load without blocking the others", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    FakeFontFace.failing.add("Broken");

    applyThemeFonts("aurora", [{ family: "Broken", file: "missing.woff2" }, FONTS[0]]);
    await settled();

    expect(fonts.added).toEqual([FakeFontFace.instances[1]]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("does not register a font whose load settles after a newer call superseded it", async () => {
    FakeFontFace.deferred.add("Slow");

    applyThemeFonts("aurora", [{ family: "Slow", file: "slow.woff2" }]);
    applyThemeFonts("borealis", [FONTS[0]]);
    await settled();
    const newFace = FakeFontFace.instances[1];

    FakeFontFace.releaseDeferred();
    await settled();

    expect(fonts.added).toEqual([newFace]);
  });
});
