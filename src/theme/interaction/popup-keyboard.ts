import { useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab and Shift+Tab inside `container`, wrapping at either end. */
export function wrapTabWithin(
  container: HTMLElement | null,
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
) {
  if (e.key !== "Tab" || !container) return;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (nodes.length === 0) {
    e.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !container.contains(active);
  const edge = e.shiftKey ? nodes[0] : nodes[nodes.length - 1];
  if (outside || active === edge) {
    e.preventDefault();
    (e.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus();
  }
}

const SELECTED_OPTION =
  '[aria-selected="true"], [role="menuitemradio"][aria-checked="true"], [data-part="option"][data-state~="selected"]';

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

export function isTextEntry(el: { tagName: string; type?: string; isContentEditable?: boolean }): boolean {
  switch (el.tagName) {
    case "TEXTAREA":
    case "SELECT":
      return true;
    case "INPUT":
      return el.type !== "checkbox" && el.type !== "radio";
    default:
      return el.isContentEditable === true;
  }
}

/** Composite widgets that move focus with their own key handler. Deliberately not
 * `role="listbox"` or `role="menu"`: an option list is one, and it relies on this hook. */
const SELF_KEYED_WIDGET = '[data-tabs], [data-accordion], [role="grid"]';

interface KeyTarget {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  closest(selector: string): Element | null;
}

/** True when the focused element owns these keys: text entry, or a widget within the
 * popup that moves its own focus. A widget holding the popup from outside it does not count. */
export function handlesOwnArrowKeys(el: KeyTarget, popup: Element): boolean {
  if (isTextEntry(el)) return true;
  const widget = el.closest(SELF_KEYED_WIDGET);
  if (widget && popup.contains(widget)) return true;
  // A resize handle moves on arrow keys by itself and carries no widget around it.
  return el.getAttribute("role") === "separator" && el.hasAttribute("tabindex");
}

/** The item index an arrow key moves focus to inside an open popup, or `null` to leave the key alone. */
export function popupFocusMove(
  el: KeyTarget,
  popup: Element,
  key: string,
  current: number,
  count: number,
): number | null {
  if (handlesOwnArrowKeys(el, popup)) return null;
  return popupKeyTarget(key, current, count);
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
      // A popup with a search box opens ready to type.
      const search = popup.querySelector<HTMLElement>('[data-part="search"]');
      const selected = popup.querySelector<HTMLElement>(SELECTED_OPTION);
      const initial =
        search ??
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
        if (isTextEntry(target as unknown as KeyTarget)) return;
        e.stopPropagation();
        if (target instanceof HTMLInputElement && target.type === "checkbox") {
          e.preventDefault();
          target.click();
        }
        return;
      }

      // A text box types, and a widget in the popup moves its own focus: leave their keys alone.
      const items = Array.from(popup.querySelectorAll<HTMLElement>(FOCUSABLE));
      const next = popupFocusMove(
        target as unknown as KeyTarget,
        popup,
        e.key,
        items.indexOf(target as HTMLElement),
        items.length,
      );
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
