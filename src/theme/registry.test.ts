import { describe, expect, it } from "vitest";
import { REGISTRY } from "./registry";

const kinds = ["display", "input", "action", "nav", "notice", "list", "block"];
const subjects = ["server", "mod", "serverMod", "modServer", "workshopMod"];

describe("shared v2 registry", () => {
  it("has valid option defaults and resolvable references", () => {
    expect(REGISTRY.registryVersion).toBe("2.0");
    for (const [id, element] of Object.entries(REGISTRY.elements)) {
      expect(kinds, id).toContain(element.kind);
      expect(["many", "perComposition", "perContext"], id).toContain(element.multiplicity);
      expect(element.where.length, id).toBeGreaterThan(0);
      expect(element.freeLabel, id).toBe("label" in element.options);
      if (element.required.length) expect(element.freeLabel, id).toBe(false);
      for (const option of Object.values(element.options)) {
        expect(["enum", "boolean", "icon", "text", "length", "token", "region"], id).toContain(option.type);
        if (option.type === "enum") {
          expect(option.values.length, id).toBeGreaterThan(0);
          if (option.default !== undefined) expect(option.values, id).toContain(option.default);
        } else if ("default" in option) {
          expect(typeof option.default, id).toBe(option.type === "boolean" ? "boolean" : "string");
          if (option.type === "icon") expect(REGISTRY.icons, id).toContain(option.default);
        }
      }
    }
    for (const surface of Object.values(REGISTRY.surfaces)) {
      for (const id of surface.contains) expect(REGISTRY.elements).toHaveProperty(id);
    }
    for (const [id, list] of Object.entries(REGISTRY.lists)) {
      expect(REGISTRY.elements[id].kind).toBe("list");
      expect(subjects).toContain(list.subject);
      if (list.defaultSort) expect(list.sortKeys).toContain(list.defaultSort.key);
    }
    for (const modal of Object.values(REGISTRY.modals)) {
      for (const id of modal.required) expect(REGISTRY.elements[id]).toBeDefined();
    }
    for (const popup of Object.values(REGISTRY.popups)) {
      expect(REGISTRY.elements[popup.openedBy]).toBeDefined();
      for (const id of popup.requiredContents) expect(REGISTRY.elements[id]).toBeDefined();
    }
    for (const [id, block] of Object.entries(REGISTRY.blocks)) {
      expect(REGISTRY.elements).toHaveProperty(id);
      expect(REGISTRY.elements[id].kind).toBe("block");
      expect(block.where).toEqual(REGISTRY.elements[id].where);
    }
  });

  it("keeps the registry's own sizes and icon allowlist", () => {
    expect(Object.keys(REGISTRY.elements)).toHaveLength(184);
    expect(new Set(REGISTRY.icons).size).toBe(45);
    expect(REGISTRY.icons).toHaveLength(45);
  });
});
