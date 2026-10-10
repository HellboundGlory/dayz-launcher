import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { placePopup, type Align, type Side } from "./popup-position";

export interface AnchoredPopupOptions {
  side: Side;
  align: Align;
  offset: number;
  maxHeight?: string;
}

const DEFAULT_MAX_HEIGHT = "320px";

/** A CSS length (px, rem, vh, %) in pixels, as the browser resolves it for a fixed box. */
function resolveLengthPx(value: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;visibility:hidden;height:${value}`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

export function useAnchoredPopup(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  opts: AnchoredPopupOptions,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(() => ({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
    maxHeight: opts.maxHeight ?? DEFAULT_MAX_HEIGHT,
  }));

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;

    const themeMax = opts.maxHeight ?? DEFAULT_MAX_HEIGHT;
    const capPx = resolveLengthPx(themeMax);

    const measure = () => {
      const rect = trigger.getBoundingClientRect();
      const placement = placePopup({
        trigger: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        // scrollHeight is the content's own height, not what the last cap squeezed it to.
        popup: { width: popup.offsetWidth, height: popup.scrollHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side: opts.side,
        align: opts.align,
        offset: opts.offset,
        maxHeight: capPx,
      });
      const next: CSSProperties = {
        position: "fixed",
        top: placement.top,
        left: placement.left,
        maxHeight: `min(${themeMax}, ${placement.maxHeight}px)`,
      };
      setStyle((prev) =>
        prev.top === next.top &&
        prev.left === next.left &&
        prev.maxHeight === next.maxHeight
          ? prev
          : next,
      );
    };

    const onScroll = (e: Event) => {
      if (popup.contains(e.target as Node)) return;
      measure();
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, true);
    const resized =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resized?.observe(popup);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, true);
      resized?.disconnect();
    };
  }, [
    open,
    triggerRef,
    popupRef,
    opts.side,
    opts.align,
    opts.offset,
    opts.maxHeight,
  ]);

  return style;
}
