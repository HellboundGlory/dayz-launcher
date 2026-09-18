import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { HostNode, ModalLayoutFile } from "../renderer/types";
import { positionStyle, type SettingsValues } from "../renderer/props";
import { LayoutNodeRenderer, RenderContextProvider } from "../renderer/node-renderer";

export interface ModalHostProps {
  file: ModalLayoutFile;
  isOpen?: boolean;
  onClose: () => void;
  outlets?: Record<string, ReactNode>;
  renderElement?: (node: HostNode) => ReactNode;
  settings?: SettingsValues;
  themeId?: string;
}

export function ModalHost({
  file,
  isOpen = true,
  onClose,
  outlets,
  renderElement,
  settings,
  themeId = "",
}: ModalHostProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const placement = file.placement ?? { mode: "center" };
  const backdrop = file.backdrop ?? "dim";

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable && focusable.length > 0) {
      const primary = modalRef.current?.querySelector<HTMLElement>(
        '[data-primary="true"], [data-action="primary"], button[type="submit"]',
      );
      (primary ?? focusable[0]).focus();
    }

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const nodes = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === backdropRef.current) {
      onClose();
    }
  };

  const backdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    backgroundColor: backdrop === "dim" ? "rgba(0, 0, 0, 0.65)" : "transparent",
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
      ref={backdropRef}
      data-modal-host=""
      data-backdrop={backdrop}
      data-placement={placement.mode}
      style={backdropStyle}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        data-part="modal-dialog"
        style={dialogStyle}
      >
        <RenderContextProvider value={renderCtx}>
          <LayoutNodeRenderer node={file.root} />
        </RenderContextProvider>
      </div>
    </div>
  );
}
