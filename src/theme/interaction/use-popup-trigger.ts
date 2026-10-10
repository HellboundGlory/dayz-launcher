import { useCallback, useEffect, useRef, useState } from "react";
import type { PopupLayoutFile } from "../renderer/types";
import { FOCUSABLE, popupTrigger, usePopupKeyboard } from "./popup-keyboard";
import type { Align, Side } from "./popup-position";
import { useAnchoredPopup } from "./use-anchored-popup";

// An action that closes the popup can also disable the trigger, and a disabled trigger drops focus to the body.
function recoverFocus(root: HTMLElement) {
  const trigger = popupTrigger(root);
  const active = document.activeElement;
  if (!trigger?.matches(":disabled")) return;
  if (active && active !== trigger && active !== document.body) return;
  const next =
    root.parentElement?.closest<HTMLElement>(FOCUSABLE) ??
    Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
      (el) => !root.contains(el) && Boolean(root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
  next?.focus();
}

export function usePopupTrigger(
  placement: { side: Side; align: Align },
  themedPopup?: PopupLayoutFile,
) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupStyle = useAnchoredPopup(open && !themedPopup, ref, popupRef, { ...placement, offset: 4 });

  const close = useCallback(() => {
    const root = ref.current;
    if (root?.contains(document.activeElement)) {
      popupTrigger(root)?.focus();
      requestAnimationFrame(() => recoverFocus(root));
    }
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  usePopupKeyboard(open && !themedPopup, popupRef, close);

  return { open, setOpen, close, ref, popupRef, popupStyle };
}
