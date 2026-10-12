import { useEffect, useRef } from "react";
import { useConfirmStore } from "@/stores/confirm-store";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { wrapTabWithin } from "@/theme/interaction/popup-keyboard";

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
    if (request) cancelRef.current?.focus();
  }, [request]);
  useEscapeLayer(!!request, () => resolve(false));

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center [background-color:var(--t-color-scrim)] p-4"
      onClick={() => resolve(false)}
    >
      <div
        ref={wrapRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={(e) => wrapTabWithin(wrapRef.current, e)}
        className="w-80 [border-radius:var(--t-radius-confirm)] border border-line bg-surface p-3 [box-shadow:var(--t-shadow-confirm)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p data-part="title" className="[font-size:var(--t-type-subheading-size)] font-bold leading-4 text-ink">
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
            className="[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            data-part="confirm"
            onClick={() => resolve(true)}
            className="[border-radius:var(--t-radius-control)] bg-danger px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider [color:var(--t-color-onDanger)] transition-colors hover:brightness-110"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
