import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { anchorGap, placePopup, type Align, type Side } from "./popup-position";

export interface AnchoredPopupOptions {
  side: Side;
  align: Align;
  offset: number;
  maxHeight?: string;
  matchTriggerWidth?: boolean;
}

/** A CSS length (px, rem, vh, %) in pixels, as the browser resolves it for a fixed box. */
export function resolveLengthPx(value: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;visibility:hidden;height:${value}`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

/** The popup's own CSS layout, read with the hook's inline placement cleared (a previous placement would otherwise win). */
function naturalLayout(popup: HTMLElement) {
  const saved = popup.style.cssText;
  popup.style.cssText = "";
  const css = getComputedStyle(popup);
  const layout = {
    absolute: css.position === "absolute",
    maxHeight: css.maxHeight,
    rect: popup.getBoundingClientRect(),
  };
  popup.style.cssText = saved;
  return layout;
}

/** Shows an open popup in the browser's top layer, which no ancestor can clip or move it out of. */
export function showInTopLayer(popup: HTMLElement): () => void {
  if (typeof popup.showPopover !== "function") return () => {};

  popup.setAttribute("popover", "manual");
  try {
    popup.showPopover();
  } catch {
    // showPopover throws on a detached element.
    popup.removeAttribute("popover");
    return () => {};
  }

  return () => {
    if (popup.matches(":popover-open")) popup.hidePopover();
    // Without the attribute the browser stops hiding a closed popup that stays mounted.
    popup.removeAttribute("popover");
  };
}

export function useAnchoredPopup(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  opts: AnchoredPopupOptions,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(() => ({
    position: "fixed",
    zIndex: "var(--z-popup)",
    top: 0,
    left: 0,
    right: "auto",
    bottom: "auto",
    margin: 0,
    visibility: "hidden",
    maxHeight: opts.maxHeight,
  }));

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;

    // Read first: a popup its CSS places absolutely measures its gap against the trigger's container, not the window.
    const natural = naturalLayout(popup);
    const hideFromTopLayer = showInTopLayer(popup);
    const themeMax = opts.maxHeight ?? natural.maxHeight;
    const capPx = themeMax === "none" ? Infinity : resolveLengthPx(themeMax);
    // A popup its own CSS places absolutely keeps the gap that CSS gives it; anything else takes opts.offset.
    const offset = natural.absolute
      ? anchorGap(opts.side, trigger.getBoundingClientRect(), natural.rect)
      : opts.offset;

    const measure = () => {
      const rect = trigger.getBoundingClientRect();
      const placement = placePopup({
        trigger: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
        // Content height plus borders: scrollHeight leaves the borders out, and offsetHeight is squeezed by the last cap.
        popup: {
          width: opts.matchTriggerWidth ? rect.width : popup.offsetWidth,
          height: popup.scrollHeight + popup.offsetHeight - popup.clientHeight,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side: opts.side,
        align: opts.align,
        offset,
        maxHeight: capPx,
      });
      const next: CSSProperties = {
        position: "fixed",
        zIndex: "var(--z-popup)",
        top: placement.top,
        left: placement.left,
        right: "auto",
        bottom: "auto",
        // The measured gap already includes the theme's margin.
        margin: 0,
        width: opts.matchTriggerWidth ? rect.width : undefined,
        maxHeight:
          themeMax === "none"
            ? `${placement.maxHeight}px`
            : `min(${themeMax}, ${placement.maxHeight}px)`,
      };
      setStyle((prev) =>
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
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
    resized?.observe(trigger);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, true);
      resized?.disconnect();
      hideFromTopLayer();
    };
  }, [
    open,
    triggerRef,
    popupRef,
    opts.side,
    opts.align,
    opts.offset,
    opts.maxHeight,
    opts.matchTriggerWidth,
  ]);

  return style;
}
