/** Stylesheet `<link>` lifecycle across theme switches. Runs against a hand-rolled DOM stub:
 * the project's vitest environment is `node`, and this module only touches a narrow slice of it. */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface CssLoader {
  applyThemeStylesheet: (themeId: string | null, capabilities: string[]) => void;
}

interface FakeElement {
  attributes: Record<string, string>;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
}

interface FakeHead {
  appendChild: (el: FakeElement) => void;
}

interface FakeDocument {
  head: FakeHead;
  getElementById: (id: string) => FakeElement | null;
  createElement: (tag: string) => FakeElement;
}

let head: FakeElement[];
let applyThemeStylesheet: CssLoader["applyThemeStylesheet"];

beforeEach(async () => {
  vi.resetModules();

  head = [];
  const document: FakeDocument = {
    head: { appendChild: (el) => void head.push(el) },
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

  const mod = (await import("./css-loader")) as CssLoader;
  applyThemeStylesheet = mod.applyThemeStylesheet;
});

describe("applyThemeStylesheet", () => {
  it("adds one stylesheet link for a css-capable theme", () => {
    applyThemeStylesheet("aurora", ["tokens", "css"]);

    expect(head).toHaveLength(1);
    expect(head[0].attributes).toMatchObject({
      id: "tetra-theme-css",
      rel: "stylesheet",
      href: "tetra-theme://localhost/aurora/styles.css",
      layer: "theme",
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
    expect(head[0].attributes.href).toBe("tetra-theme://localhost/aurora/styles.css");
    expect(head[0].attributes.layer).toBe("theme");
  });

  it("updates the existing link in place when the theme id changes", () => {
    applyThemeStylesheet("aurora", ["css"]);
    const first = head[0];

    applyThemeStylesheet("borealis", ["css"]);

    expect(head).toHaveLength(1);
    expect(head[0]).toBe(first);
    expect(first.attributes.href).toBe("tetra-theme://localhost/borealis/styles.css");
    expect(first.attributes.layer).toBe("theme");
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

  it("configures theme stylesheet in the 'theme' cascade layer", () => {
    applyThemeStylesheet("aurora", ["css"]);
    expect(head[0].attributes.layer).toBe("theme");
  });

  it("ensures layer='theme' is present when updating an existing link missing the attribute", () => {
    applyThemeStylesheet("aurora", ["css"]);
    delete head[0].attributes.layer;

    applyThemeStylesheet("borealis", ["css"]);
    expect(head[0].attributes.layer).toBe("theme");
  });
});

