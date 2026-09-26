import { REGISTRY, type FallbackPlacement } from "../registry";
import type { Anchor, ElementNode, LayoutFile, LayoutNode, BoxNode } from "../renderer/types";

export interface AutoPlacedEntry {
  element: string;
  placement: string;
}

export interface AutoPlacementResult {
  layout: LayoutFile;
  autoPlaced: AutoPlacedEntry[];
}

export function isElementInNode(node: LayoutNode | undefined, elementId: string): boolean {
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

export function getMissingRequiredElements(layout: LayoutFile, targetContext: string): string[] {
  const missing: string[] = [];

  for (const [id, def] of Object.entries(REGISTRY.elements)) {
    const isReq =
      def.required.includes(targetContext) ||
      (targetContext === "withJoin" && def.required.includes("withJoin")) ||
      (def.required.includes("withJoin") && isElementInLayout(layout, "server.join"));

    if (isReq && !isElementInLayout(layout, id)) {
      missing.push(id);
    }
  }

  if (targetContext.startsWith("modal:")) {
    const modalId = targetContext.slice("modal:".length);
    const modalDef = REGISTRY.modals[modalId];
    if (modalDef?.required) {
      for (const reqId of modalDef.required) {
        if (!isElementInLayout(layout, reqId) && !missing.includes(reqId)) {
          missing.push(reqId);
        }
      }
    }
  }

  return missing;
}

export function resolveFallbackPlacement(elementId: string, targetContext: string): FallbackPlacement {
  const def = REGISTRY.elements[elementId];
  if (def?.fallbackPlacement) {
    if (def.fallbackPlacement[targetContext]) {
      return def.fallbackPlacement[targetContext];
    }
    if (
      def.fallbackPlacement["withJoin"] &&
      (targetContext === "withJoin" ||
        targetContext.includes("join") ||
        targetContext.includes("row") ||
        targetContext.includes("serverInfo"))
    ) {
      return def.fallbackPlacement["withJoin"];
    }
    const values = Object.values(def.fallbackPlacement);
    if (values.length > 0) return values[0];
  }

  // Fall back to context string directly if it encodes a placement (e.g. in tests)
  if (targetContext.startsWith("afterElement:") || targetContext.startsWith("anchor:") || targetContext === "append") {
    return targetContext as FallbackPlacement;
  }

  return "append";
}

function insertAfterInContainer(node: LayoutNode, targetId: string, toInsert: LayoutNode): boolean {
  if ("children" in node && Array.isArray(node.children)) {
    const idx = node.children.findIndex((c) => "element" in c && c.element === targetId);
    if (idx !== -1) {
      node.children.splice(idx + 1, 0, toInsert);
      return true;
    }
    for (const child of node.children) {
      if (insertAfterInContainer(child, targetId, toInsert)) return true;
    }
  }
  if ("type" in node && node.type === "tabs" && Array.isArray(node.tabs)) {
    for (const tab of node.tabs) {
      if (insertAfterInContainer(tab.content, targetId, toInsert)) return true;
    }
  }
  if ("type" in node && node.type === "accordion" && Array.isArray(node.sections)) {
    for (const sec of node.sections) {
      if (insertAfterInContainer(sec.body, targetId, toInsert)) return true;
    }
  }
  return false;
}

function placeElementInNode(rootNode: LayoutNode, elementId: string, placement: FallbackPlacement): LayoutNode {
  if (placement.startsWith("afterElement:")) {
    const targetId = placement.slice("afterElement:".length);
    const elementNode: ElementNode = { element: elementId };
    const inserted = insertAfterInContainer(rootNode, targetId, elementNode);
    if (inserted) return rootNode;
    // Target element was not found in container children, fall back to append
    return placeElementInNode(rootNode, elementId, "append");
  }

  if (placement.startsWith("anchor:")) {
    const anchor = placement.slice("anchor:".length) as Anchor;
    const elementNode: ElementNode = { element: elementId, position: { anchor } };
    if ("children" in rootNode && Array.isArray(rootNode.children)) {
      rootNode.children.push(elementNode);
      return rootNode;
    }
    return { type: "box", children: [rootNode, elementNode] } as BoxNode;
  }

  // "append"
  const elementNode: ElementNode = { element: elementId };
  if ("children" in rootNode && Array.isArray(rootNode.children)) {
    rootNode.children.push(elementNode);
    return rootNode;
  }
  return { type: "box", children: [rootNode, elementNode] } as BoxNode;
}

export function applyAutoPlacement(
  layout: LayoutFile,
  targetContext: string,
  missingElements?: string[],
): AutoPlacementResult {
  const elementsToPlace = missingElements ?? getMissingRequiredElements(layout, targetContext);
  const toPlace = elementsToPlace.filter((el) => !isElementInLayout(layout, el));

  if (toPlace.length === 0) {
    return { layout, autoPlaced: [] };
  }

  const cloned: LayoutFile = JSON.parse(JSON.stringify(layout));
  const autoPlaced: AutoPlacedEntry[] = [];

  for (const el of toPlace) {
    const placement = resolveFallbackPlacement(el, targetContext);
    autoPlaced.push({ element: el, placement });

    if (cloned.root) {
      cloned.root = placeElementInNode(cloned.root, el, placement);
    }
    if (cloned.variants) {
      for (const v of cloned.variants) {
        if (v.root && !isElementInNode(v.root, el)) {
          v.root = placeElementInNode(v.root, el, placement);
        }
      }
    }
    const asList = cloned as unknown as { row?: LayoutNode };
    if (asList.row && !isElementInNode(asList.row, el)) {
      asList.row = placeElementInNode(asList.row, el, placement);
    }
    if (!cloned.root && !cloned.variants && !asList.row) {
      cloned.root = placeElementInNode({ type: "box", children: [] } as BoxNode, el, placement);
    }
  }

  return { layout: cloned, autoPlaced };
}
