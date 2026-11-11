import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore, type Toast, type ToastTone } from "@/stores/toast-store";
import { useNoticeToasts } from "@/theme/elements/notice-toasts";

const TONE: Record<ToastTone, { stripe: string; tag: string; button: string }> = {
  info: { stripe: "before:bg-accent", tag: "text-accent", button: "bg-accent" },
  success: { stripe: "before:bg-success", tag: "text-success", button: "bg-success" },
  warning: { stripe: "before:bg-warn", tag: "text-warn", button: "bg-warn" },
  error: { stripe: "before:bg-danger", tag: "text-danger", button: "bg-danger" },
};

interface Point {
  x: number;
  y: number;
}

export function pointerOver(
  box: { left: number; right: number; top: number; bottom: number },
  point: Point | null,
): boolean {
  if (!point) return false;
  return point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom;
}

export function ToastHost() {
  const noticeToasts = useNoticeToasts();
  const entries = useToastStore((s) => s.entries);
  const hidden = useToastStore((s) => s.hidden);
  const paused = useToastStore((s) => s.paused);
  const setNoticeToasts = useToastStore((s) => s.setNoticeToasts);
  const setPaused = useToastStore((s) => s.setPaused);
  const closeToast = useToastStore((s) => s.closeToast);
  // The pointer and focus each hold the clocks; only the last one out restarts them.
  const held = useRef({ pointer: false, focus: false });
  const hostRef = useRef<HTMLElement>(null);
  const pointer = useRef<Point | null>(null);

  // Fed from an effect rather than during render, which would set state mid-render.
  useEffect(() => setNoticeToasts(noticeToasts), [noticeToasts, setNoticeToasts]);

  // Scrolling clips the cards' shadows, so the stack only scrolls once it
  // outgrows the window.
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Both heights round to whole pixels, so allow one pixel either way.
    const measure = () => setOverflowing(host.scrollHeight - host.clientHeight > 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [entries]);

  const shown = entries.filter((entry) => !hidden.includes(entry.toast.key));

  // A closed toast takes its focused button or the hovered card with it, and no
  // blur or pointerleave follows, so check the holds whenever the stack changes.
  // `:hover` still names the removed card until the pointer moves, so test the
  // last pointer position against the stack's new box instead.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const focusInside = host.contains(document.activeElement);
    const pointerInside =
      shown.length > 0 && pointerOver(host.getBoundingClientRect(), pointer.current);
    // Forget a point the stack no longer covers, so a later toast growing over it can't hold.
    if (!pointerInside) pointer.current = null;
    if (held.current.focus === focusInside && held.current.pointer === pointerInside) return;
    held.current = { focus: focusInside, pointer: pointerInside };
    setPaused(focusInside || pointerInside);
  }, [shown.length, entries, setPaused]);

  const hold = (reason: "pointer" | "focus", on: boolean) => {
    held.current[reason] = on;
    setPaused(held.current.pointer || held.current.focus);
  };

  return (
    <section
      ref={hostRef}
      data-toast-host
      aria-label="Notifications"
      onPointerEnter={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
        hold("pointer", true);
      }}
      onPointerMove={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerLeave={() => {
        pointer.current = null;
        hold("pointer", false);
      }}
      onFocus={() => hold("focus", true)}
      onBlur={(event) => {
        // Moving between controls inside the stack never lifts the hold.
        if (!event.currentTarget.contains(event.relatedTarget)) hold("focus", false);
      }}
      className={cn(
        "fixed top-[132px] right-[14px] z-[var(--z-toast)] flex max-h-[calc(100vh_-_146px)] w-[370px] max-w-[calc(100%_-_28px)] flex-col gap-2",
        overflowing && "overflow-y-auto",
      )}
    >
      {shown.map(({ toast, quick }) => (
        <ToastCard
          key={toast.key}
          toast={toast}
          quick={quick}
          paused={paused}
          onClose={() => closeToast(toast.key)}
        />
      ))}
    </section>
  );
}

function ToastCard({
  toast,
  quick,
  paused,
  onClose,
}: {
  toast: Toast;
  quick: boolean;
  paused: boolean;
  onClose: () => void;
}) {
  const tone = TONE[toast.tone];
  const closable = toast.closable !== false;

  return (
    <div
      data-part="toast"
      data-state={toast.tone}
      role={toast.tone === "error" ? "alert" : "status"}
      className={cn(
        "relative grid shrink-0 grid-cols-[auto_1fr_auto] items-start gap-x-2.5 gap-y-1 overflow-hidden",
        "border border-line bg-surface py-2.5 pl-3 pr-2",
        "[border-radius:var(--t-radius-confirm)] [box-shadow:var(--t-shadow-confirm)]",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        tone.stripe,
      )}
    >
      <span
        data-part="tag"
        title={toast.detail}
        className={cn(
          "pt-0.5 [font-size:9.5px] font-semibold uppercase tracking-[0.08em]",
          tone.tag,
        )}
      >
        {toast.tag}
      </span>

      <span className="min-w-0 [overflow-wrap:anywhere] [font-size:12.5px] leading-[1.4] text-ink">
        {toast.title && (
          <span data-part="title" className="font-semibold">
            {toast.title}{" "}
          </span>
        )}
        <span data-part="message">{toast.message}</span>
      </span>

      {closable ? (
        <button
          type="button"
          data-part="close"
          aria-label="Close notification"
          onClick={onClose}
          className="grid size-[22px] place-items-center rounded-[var(--t-radius-controlSmall)] text-muted2 transition-colors hover:text-ink"
        >
          <X size={13} aria-hidden />
        </button>
      ) : (
        <span />
      )}

      {toast.actions && toast.actions.length > 0 && (
        <div data-part="actions" className="col-[2/4] mt-1 flex gap-1.5">
          {toast.actions.map((action, index) => (
            <button
              key={index}
              type="button"
              disabled={action.disabled}
              onClick={action.onClick}
              className={cn(
                "[border-radius:var(--t-radius-controlSmall)] px-2.5 py-1 [font-size:10px] font-semibold uppercase tracking-[0.05em] transition-colors",
                action.primary
                  ? cn(tone.button, "[color:var(--t-color-onAccent)] hover:brightness-110")
                  : "text-muted hover:text-ink",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {quick && (
        <span
          data-part="life"
          aria-hidden
          style={{
            animation: "toast-life 5s linear forwards",
            animationPlayState: paused ? "paused" : "running",
          }}
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent-line"
        />
      )}
    </div>
  );
}
