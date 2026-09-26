import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { HostNode, PopupLayoutFile } from "../renderer/types";
import { type SettingsValues } from "../renderer/props";
import { LayoutNodeRenderer, RenderContextProvider } from "../renderer/node-renderer";
import { useResolvedRoot } from "../renderer/use-resolved-root";
import { parseLengthPx } from "./resizable";

export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface PopupHostProps {
  file: PopupLayoutFile;
  isOpen?: boolean;
  onClose: () => void;
  triggerRect?: TriggerRect;
  triggerRef?: RefObject<HTMLElement | null>;
  outlets?: Record<string, ReactNode>;
  renderElement?: (node: HostNode) => ReactNode;
  settings?: SettingsValues;
  themeId?: string;
}

export function PopupHost({
  file,
  isOpen = true,
  onClose,
  triggerRect,
  triggerRef,
  outlets,
  renderElement,
  settings,
  themeId = "",
}: PopupHostProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const placement = file.placement ?? { mode: "anchored" };
  const mode = placement.mode;
  const side = placement.side ?? "bottom";
  const align = placement.align ?? "start";
  const offsetPx = parseLengthPx(placement.offset, 4);
  const root = useResolvedRoot(file);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    const triggerEl = triggerRef?.current;

    // Focus into popup: first item or active
    const focusable = popupRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable && focusable.length > 0) {
      const selected = popupRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      (selected ?? focusable[0]).focus();
    }

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      if (triggerEl?.contains(target)) return;
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      triggerEl?.focus();
    };
  }, [isOpen, onClose, triggerRef]);


  if (!isOpen) return null;

  let containerStyle: CSSProperties = {
    maxHeight: placement.maxHeight,
  };

  if (mode === "anchored") {
    containerStyle = {
      position: "fixed",
      zIndex: 40,
      maxHeight: placement.maxHeight ?? "320px",
      overflowY: "auto",
      ...containerStyle,
    };

    if (triggerRect) {
      if (side === "bottom") {
        containerStyle.top = triggerRect.bottom + offsetPx;
      } else if (side === "top") {
        containerStyle.bottom = (typeof window !== "undefined" ? window.innerHeight : 800) - triggerRect.top + offsetPx;
      } else if (side === "right") {
        containerStyle.left = triggerRect.right + offsetPx;
      } else if (side === "left") {
        containerStyle.right = (typeof window !== "undefined" ? window.innerWidth : 1200) - triggerRect.left + offsetPx;
      }

      if (side === "bottom" || side === "top") {
        if (align === "start") containerStyle.left = triggerRect.left;
        else if (align === "end") containerStyle.right = (typeof window !== "undefined" ? window.innerWidth : 1200) - triggerRect.right;
        else if (align === "center") containerStyle.left = triggerRect.left + triggerRect.width / 2;
      } else {
        if (align === "start") containerStyle.top = triggerRect.top;
        else if (align === "end") containerStyle.bottom = (typeof window !== "undefined" ? window.innerHeight : 800) - triggerRect.bottom;
        else if (align === "center") containerStyle.top = triggerRect.top + triggerRect.height / 2;
      }
    }
  } else if (mode === "inline") {
    containerStyle = {
      position: "relative",
      width: "100%",
      maxHeight: placement.maxHeight,
      ...containerStyle,
    };
  } else if (mode === "region") {
    containerStyle = {
      width: "100%",
      height: "100%",
      maxHeight: placement.maxHeight,
      ...containerStyle,
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
      ref={popupRef}
      data-popup-host=""
      data-mode={mode}
      data-side={side}
      data-align={align}
      role="dialog"
      aria-modal="false"
      style={containerStyle}
    >
      <RenderContextProvider value={renderCtx}>
        <LayoutNodeRenderer node={root} />
      </RenderContextProvider>
    </div>
  );
}
