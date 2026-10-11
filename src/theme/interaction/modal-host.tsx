import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { HostNode, ModalLayoutFile } from "../renderer/types";
import { positionStyle, type SettingsValues } from "../renderer/props";
import { LayoutNodeRenderer, RenderContextProvider } from "../renderer/node-renderer";
import { useLayoutCollapseRules } from "../renderer/layout-renderer";
import { useResolvedRoot } from "../renderer/use-resolved-root";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const PRIMARY = '[data-primary="true"], [data-action="primary"], button[type="submit"]';

// Only the topmost modal handles keys, so a confirm dialog above this one owns them even with focus on body.
function isTopModal(self: HTMLElement | null) {
  const all = document.querySelectorAll('[aria-modal="true"]');
  return all[all.length - 1] === self;
}

export interface ModalHostProps {
  file: ModalLayoutFile;
  initialFocus?: string;
  isOpen?: boolean;
  label?: string;
  onClose: () => void;
  outlets?: Record<string, ReactNode>;
  renderElement?: (node: HostNode) => ReactNode;
  settings?: SettingsValues;
  themeId?: string;
}

export function ModalHost({
  file,
  initialFocus,
  isOpen = true,
  label,
  onClose,
  outlets,
  renderElement,
  settings,
  themeId = "",
}: ModalHostProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  const placement = file.placement ?? { mode: "center" };
  const backdrop = file.backdrop ?? "dim";
  const root = useResolvedRoot(file);
  useLayoutCollapseRules(root);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const modal = modalRef.current;
    const focusable = modal?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (modal && focusable && focusable.length > 0) {
      const explicit = initialFocus
        ? Array.from(modal.querySelectorAll<HTMLElement>(initialFocus)).find((el) =>
            el.matches(FOCUSABLE),
          )
        : undefined;
      const primary = modal.querySelector<HTMLElement>(PRIMARY);
      (explicit ?? primary ?? focusable[0]).focus();
    }

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!isTopModal(modalRef.current)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const nodes = Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) {
          e.preventDefault();
          return;
        }

        const first = nodes[0];
        const last = nodes[nodes.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, initialFocus]);

  if (!isOpen) return null;

  const backdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: "var(--z-modal)",
    display: "flex",
    ...(placement.mode === "center" && {
      alignItems: "center",
      justifyContent: "center",
    }),
  };

  let dialogStyle: CSSProperties = {
    position: "relative",
    maxWidth: "100vw",
    maxHeight: "100vh",
  };

  if (placement.mode === "anchor" && placement.anchor) {
    dialogStyle = {
      ...dialogStyle,
      ...positionStyle({ anchor: placement.anchor, x: placement.x, y: placement.y }),
    };
  }

  const renderCtx = {
    settings: settings ?? {},
    outlets: outlets ?? {},
    renderElement,
    themeId,
  };

  return (
    <div
      data-modal-host=""
      data-backdrop={backdrop}
      data-placement={placement.mode}
      style={backdropStyle}
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-label={label}
        aria-modal="true"
        data-part="modal-dialog"
        style={dialogStyle}
      >
        <RenderContextProvider value={renderCtx}>
          <LayoutNodeRenderer node={root} />
        </RenderContextProvider>
      </div>
    </div>
  );
}
