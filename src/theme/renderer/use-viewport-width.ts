import { useEffect, useState } from "react";

/** Resize settles for this long before the width is re-read (§5.2, §15). */
const DEBOUNCE_MS = 100;

/** The window's CSS width, or 0 where there is no window (SSR, tests). Page zoom
 * is already applied: a 975px window at 1.5x scale reports 650. */
export function readViewportWidth(): number {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

/** Calls `onChange` once per settled resize. Returns the unsubscribe. */
export function subscribeViewportWidth(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let timer: number | undefined;
  const onResize = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onChange, DEBOUNCE_MS);
  };
  window.addEventListener("resize", onResize);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("resize", onResize);
  };
}

/** The width a layout file's variants are picked against (§5.2). */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(readViewportWidth);
  useEffect(() => subscribeViewportWidth(() => setWidth(readViewportWidth())), []);
  return width;
}
