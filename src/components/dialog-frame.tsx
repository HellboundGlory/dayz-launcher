import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { wrapTabWithin } from "@/theme/interaction/popup-keyboard";
import { showOverlayInTopLayer } from "@/theme/interaction/use-anchored-popup";

const SCRIM =
  "fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 [background-color:var(--t-color-scrim)]";
const FRAME =
  "border border-line bg-surface [border-radius:var(--t-radius-confirm)] [box-shadow:var(--t-shadow-confirm)]";

export interface DialogFrameProps {
  /** The dialog's name, for a frame with no visible heading to point at. */
  label?: string;
  /** The id of the frame's heading, when the heading is on screen. */
  labelledBy?: string;
  /** Closes on a press on the scrim; leave it off where a stray press must not dismiss. */
  onBackdropClick?: () => void;
  /** The scrim's own classes, for a dialog above the usual layer or with a blurred backdrop. */
  scrimClassName?: string;
  /** Stays above popups and dialogs opened after it. */
  stayOnTop?: boolean;
  /** The frame's own size and look. */
  className?: string;
  children: ReactNode;
}

/** The scrim, the dialog role and the Tab trap that the app's dialogs share. */
export function DialogFrame({
  label,
  labelledBy,
  onBackdropClick,
  scrimClassName,
  stayOnTop,
  className,
  children,
}: DialogFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);

  // Paints above a popup that was still open when this dialog mounted.
  useLayoutEffect(() => {
    if (!scrimRef.current) return;
    return showOverlayInTopLayer(scrimRef.current);
  }, []);

  return (
    <div
      ref={scrimRef}
      data-stay-on-top={stayOnTop ? "" : undefined}
      className={cn(SCRIM, scrimClassName)}
      // A press, so releasing outside the frame after a drag that started inside keeps it open.
      onMouseDown={(e) => {
        if (onBackdropClick && e.button === 0 && e.target === e.currentTarget) onBackdropClick();
      }}
    >
      <div
        ref={frameRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        onKeyDown={(e) => wrapTabWithin(frameRef.current, e)}
        className={cn(FRAME, className)}
      >
        {children}
      </div>
    </div>
  );
}
