import { useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SELECTED_OPTION = '[aria-selected="true"], [data-part="option"][data-state~="selected"]';

export function popupKeyTarget(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function popupTrigger(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  if (root.hasAttribute("aria-haspopup")) return root;
  return root.querySelector<HTMLElement>("[aria-haspopup]") ?? root;
}

function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "radio";
}

export function usePopupKeyboard(
  open: boolean,
  popupRef: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const popup = popupRef.current;
    if (!open || !popup) return;

    // An anchored popup is visibility:hidden until its placement is applied, and hidden elements can't take focus.
    const frame = requestAnimationFrame(() => {
      const selected = popup.querySelector<HTMLElement>(SELECTED_OPTION);
      const initial =
        (selected?.matches(FOCUSABLE) ? selected : selected?.querySelector<HTMLElement>(FOCUSABLE)) ??
        popup.querySelector<HTMLElement>(FOCUSABLE);
      initial?.focus();
    });

    // Capture on document so the keys run before a list row's own handlers.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }

      const target = e.target as Element | null;
      if (!target || !popup.contains(target)) return;

      if (e.key === "Enter") {
        e.stopPropagation();
        if (target instanceof HTMLInputElement && target.type === "checkbox") {
          e.preventDefault();
          target.click();
        }
        return;
      }

      const active = document.activeElement;
      if (!active || isTextEntry(active)) return;

      const items = Array.from(popup.querySelectorAll<HTMLElement>(FOCUSABLE));
      const next = popupKeyTarget(e.key, items.indexOf(active as HTMLElement), items.length);
      if (next === null) return;

      e.preventDefault();
      e.stopPropagation();
      items[next].focus();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, popupRef]);
}
