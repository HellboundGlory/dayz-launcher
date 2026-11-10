import { useEffect, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { useConfirmStore } from "@/stores/confirm-store";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { DialogFrame } from "@/components/dialog-frame";

/** Ask the user to confirm before running `action`; resolved by the one launcher-owned dialog. */
export function useConfirm() {
  return useConfirmStore((s) => s.ask);
}

// Launcher-owned confirm dialog, not a registry element — its root carries no
// `data-el`, but each piece gets a stable `data-part` so themes can style it.
export function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const resolve = useConfirmStore((s) => s.resolve);
  const resolveAlt = useConfirmStore((s) => s.resolveAlt);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus Cancel by default (safer default for a destructive action); Escape closes.
  useEffect(() => {
    if (request) cancelRef.current?.focus();
  }, [request]);
  useEscapeLayer(!!request, () => resolve(false));

  if (!request) return null;

  const destructive = request.destructive !== false;

  return (
    <DialogFrame
      label={request.title}
      onBackdropClick={() => resolve(false)}
      className="w-80 p-3"
    >
      <p data-part="title" className="[font-size:var(--t-type-subheading-size)] font-bold leading-4 text-ink">
        {request.title}
      </p>
      {request.warning ? (
        <div
          data-part="warning"
          className="mt-2 flex items-start gap-2 [border-radius:var(--t-radius-control)] border border-warn-line bg-warn-soft px-2.5 py-2 [font-size:var(--t-type-body-size)] leading-relaxed text-ink"
        >
          <TriangleAlert data-part="icon" aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
          <span data-part="message">{request.message}</span>
        </div>
      ) : (
        <p data-part="message" className="mt-1.5 [font-size:var(--t-type-body-size)] leading-relaxed text-muted2">
          {request.message}
        </p>
      )}
      {request.rows && request.rows.length > 0 && (
        <div data-part="rows" className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 [font-size:var(--t-type-body-size)]">
          {request.rows.map(([label, value]) => (
            <div key={label} className="contents">
              <span data-part="row-label" className="text-muted2">
                {label}
              </span>
              <span data-part="row-value" className="font-mono-data font-medium text-ink">
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          ref={cancelRef}
          data-part="cancel"
          onClick={() => resolve(false)}
          className="[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
        >
          Cancel
        </button>
        {request.altLabel && (
          <button
            data-part="alt"
            onClick={resolveAlt}
            className="[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
          >
            {request.altLabel}
          </button>
        )}
        <button
          data-part="confirm"
          onClick={() => resolve(true)}
          className={
            destructive
              ? "[border-radius:var(--t-radius-control)] bg-danger px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider [color:var(--t-color-onDanger)] transition-colors hover:brightness-110"
              : "[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-ink transition-colors hover:border-accent"
          }
        >
          {request.confirmLabel}
        </button>
      </div>
    </DialogFrame>
  );
}
