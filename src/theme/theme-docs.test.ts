import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderElementsPage, type ElementNotes } from "../../tools/docs/theme-docs.mjs";
import { REGISTRY } from "./registry";

const notes = JSON.parse(
  readFileSync(new URL("../../tools/docs/element-notes.json", import.meta.url), "utf8"),
) as ElementNotes;
const committed = readFileSync(new URL("../../docs/docs/themes/elements.html", import.meta.url), "utf8");

describe("element reference page", () => {
  it("matches the committed page (run npm run docs:themes if this fails)", () => {
    expect(renderElementsPage(REGISTRY, notes), "run npm run docs:themes").toBe(committed);
  });

  it("documents every element, surface, list, modal and popup in the registry", () => {
    const page = renderElementsPage(REGISTRY, notes);
    for (const id of [
      ...Object.keys(REGISTRY.elements),
      ...Object.keys(REGISTRY.surfaces),
      ...Object.keys(REGISTRY.lists),
      ...Object.keys(REGISTRY.modals),
      ...Object.keys(REGISTRY.popups),
    ]) {
      expect(page, id).toContain(id);
    }
  });

  it("only writes notes for real elements", () => {
    for (const id of Object.keys(notes.elements)) expect(REGISTRY.elements, id).toHaveProperty(id);
  });
});
