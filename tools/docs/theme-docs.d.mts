// Types for the docs generator, so the vitest suite can import the plain-Node
// ESM module from TypeScript.
import type { Registry } from "../../src/theme/registry";

export interface ElementNotes {
  intro: string;
  groups: Record<string, { title: string; blurb: string }>;
  elements: Record<string, string>;
  sections: Record<string, string>;
}

export function renderElementsPage(registry: Registry, notes: ElementNotes): string;
