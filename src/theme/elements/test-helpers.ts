import { expect } from "vitest";
import registry from "../registry.json";

type ElementId = keyof typeof registry.elements;

function drawn(html: string, attr: string): string[] {
  return [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].flatMap((match) => match[1].split(" "));
}

/** Every data-part and data-state in `html` is one the registry lists for `id`. */
export function expectRegistryCovers(html: string, id: ElementId): void {
  const element = registry.elements[id];
  expect(element.parts, `${id} parts`).toEqual(expect.arrayContaining(drawn(html, "data-part")));
  expect(element.states, `${id} states`).toEqual(expect.arrayContaining(drawn(html, "data-state")));
}
