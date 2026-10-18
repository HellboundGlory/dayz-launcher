import { useEffect, useRef } from "react";

// Escape closes only the dialog, modal or overlay opened last. A per-dialog
// listener can't tell: the dialog above may already be gone from the DOM by
// the time the next listener runs.
interface Layer {
  order: number;
  close: () => void;
}

const layers: Layer[] = [];
let opened = 0;

// Taken while rendering: a parent renders before its children, though its effect runs after theirs.
function nextOrder(): number {
  return ++opened;
}

export function handleEscape(e: {
  key: string;
  preventDefault: () => void;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}) {
  // A control inside the dialog already used this Escape, or it ends text composition.
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || layers.length === 0) return;
  e.preventDefault();
  layers[layers.length - 1].close();
}

export function openEscapeLayer(close: () => void, order = nextOrder()): () => void {
  if (layers.length === 0 && typeof window !== "undefined") {
    window.addEventListener("keydown", handleEscape);
  }
  const layer = { order, close };
  const at = layers.findIndex((other) => other.order > order);
  layers.splice(at < 0 ? layers.length : at, 0, layer);
  return () => {
    const at = layers.indexOf(layer);
    if (at >= 0) layers.splice(at, 1);
    if (layers.length === 0 && typeof window !== "undefined") {
      window.removeEventListener("keydown", handleEscape);
    }
  };
}

/** A layer's order, taken when it becomes active so an always-mounted dialog still opens on top. */
export function orderWhileActive(active: boolean, held: number | null): number | null {
  if (!active) return null;
  return held ?? nextOrder();
}

export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  const held = useRef<number | null>(null);
  held.current = orderWhileActive(active, held.current);
  const order = held.current;
  useEffect(() => {
    if (order === null) return;
    return openEscapeLayer(() => latest.current(), order);
  }, [order]);
}
