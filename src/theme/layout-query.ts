import { REGISTRY } from "./registry";
import type { LayoutFile, LayoutNode } from "./renderer/types";

function isElementInNode(node: LayoutNode | undefined, elementId: string): boolean {
  if (!node) return false;

  if ("element" in node && node.element) {
    if (node.element === elementId) return true;
    const def = REGISTRY.elements[elementId];
    if (def?.aliases?.includes(node.element)) return true;
  }

  if ("surface" in node && node.surface) {
    const surfaceDef = REGISTRY.surfaces[node.surface];
    if (surfaceDef?.contains?.includes(elementId)) return true;
  }

  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (isElementInNode(child, elementId)) return true;
    }
  }

  if ("type" in node && node.type === "tabs" && Array.isArray(node.tabs)) {
    for (const tab of node.tabs) {
      if (isElementInNode(tab.label, elementId) || isElementInNode(tab.content, elementId)) {
        return true;
      }
    }
  }

  if ("type" in node && node.type === "accordion" && Array.isArray(node.sections)) {
    for (const section of node.sections) {
      if (isElementInNode(section.header, elementId) || isElementInNode(section.body, elementId)) {
        return true;
      }
    }
  }

  if (node.collapsible && isElementInNode(node.collapsible.collapsed, elementId)) {
    return true;
  }

  if (node.empty && isElementInNode(node.empty, elementId)) {
    return true;
  }

  return false;
}

export function isElementInLayout(layout: LayoutFile, elementId: string): boolean {
  if (layout.root && isElementInNode(layout.root, elementId)) return true;
  if (layout.variants) {
    for (const v of layout.variants) {
      if (v.root && isElementInNode(v.root, elementId)) return true;
    }
  }
  if (layout.row && isElementInNode(layout.row, elementId)) return true;
  return false;
}
