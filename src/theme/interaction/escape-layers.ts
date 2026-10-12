import { useEffect, useRef } from "react";

// Escape closes only the dialog, modal or overlay opened last. A per-dialog
// listener can't tell: the dialog above may already be gone from the DOM by
// the time the next listener runs.
const layers: Array<() => void> = [];

export function handleEscape(e: {
  key: string;
  preventDefault: () => void;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}) {
  // A control inside the dialog already used this Escape, or it ends text composition.
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || layers.length === 0) return;
  e.preventDefault();
  layers[layers.length - 1]();
}

export function openEscapeLayer(close: () => void): () => void {
  if (layers.length === 0 && typeof window !== "undefined") {
    window.addEventListener("keydown", handleEscape);
  }
  layers.push(close);
  return () => {
    const at = layers.lastIndexOf(close);
    if (at >= 0) layers.splice(at, 1);
    if (layers.length === 0 && typeof window !== "undefined") {
      window.removeEventListener("keydown", handleEscape);
    }
  };
}

export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    return openEscapeLayer(() => latest.current());
  }, [active]);
}
