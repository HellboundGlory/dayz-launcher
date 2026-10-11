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
import { useLayoutCollapseRules } from "../renderer/layout-renderer";
import { useResolvedRoot } from "../renderer/use-resolved-root";
import { parseLengthPx } from "./resizable";
import { useAnchoredPopup } from "./use-anchored-popup";
import { usePopupKeyboard } from "./popup-keyboard";

export interface PopupHostProps {
  file: PopupLayoutFile;
  isOpen?: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  outlets?: Record<string, ReactNode>;
  renderElement?: (node: HostNode) => ReactNode;
  settings?: SettingsValues;
  themeId?: string;
}

export function PopupHost({
  file,
  isOpen = true,
  onClose,
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
  useLayoutCollapseRules(root);
  const anchoredStyle = useAnchoredPopup(isOpen && mode === "anchored", triggerRef, popupRef, {
    side,
    align,
    offset: offsetPx,
    maxHeight: placement.maxHeight ?? "320px",
  });

  usePopupKeyboard(isOpen, popupRef, onClose);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    const triggerEl = triggerRef.current;

    const onPointerDown = (e: globalThis.PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      if (triggerEl?.contains(target)) return;
      onClose();
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen, onClose, triggerRef]);


  if (!isOpen) return null;

  let containerStyle: CSSProperties = {
    maxHeight: placement.maxHeight,
  };

  if (mode === "anchored") {
    containerStyle = { zIndex: "var(--z-popup)", overflowY: "auto", ...anchoredStyle };
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
