import { useEffect, useRef, type KeyboardEvent } from "react";
import { useConfirmStore } from "@/stores/confirm-store";

/** Ask the user to confirm before running `action`; resolved by the one launcher-owned dialog (ADR-0024). */
export function useConfirm() {
  return useConfirmStore((s) => s.ask);
}

// Launcher-owned confirm dialog, not a registry element — its root carries no
// `data-el`, but each piece gets a stable `data-part` so themes can style it.
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const resolve = useConfirmStore((s) => s.resolve);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus Cancel by default (safer default for a destructive action); Escape closes.
  useEffect(() => {
    if (!request) return;
    cancelRef.current?.focus();
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") resolve(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request, resolve]);

  if (!request) return null;

  /** Tab wraps within the dialog; Shift+Tab goes backwards. */
  function trapTab(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const els = Array.from(
      wrapRef.current?.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((el) => !el.hasAttribute("disabled"));
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => resolve(false)}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={trapTab}
        className="w-80 [border-radius:var(--t-radius-confirm)] border border-line bg-surface p-3 [box-shadow:var(--t-shadow-confirm)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p data-part="title" className="text-xs font-bold text-ink">
          {request.title}
        </p>
        <p data-part="message" className="mt-1.5 [font-size:var(--t-type-body-size)] leading-relaxed text-muted2">
          {request.message}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            ref={cancelRef}
            data-part="cancel"
            onClick={() => resolve(false)}
            className="[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-3 py-1.5 [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            data-part="confirm"
            onClick={() => resolve(true)}
            className="[border-radius:var(--t-radius-control)] bg-danger px-3 py-1.5 [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider [color:var(--t-color-onDanger)] transition-colors hover:brightness-110"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
