import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { HostNode, SettingsLayoutFile } from "../renderer/types";
import { type SettingsValues } from "../renderer/props";
import { LayoutNodeRenderer, RenderContextProvider } from "../renderer/node-renderer";
import { useLayoutCollapseRules } from "../renderer/layout-renderer";
import { useResolvedRoot } from "../renderer/use-resolved-root";
import { useEscapeLayer } from "./escape-layers";

/** A mousedown closes the overlay only when it targets the overlay's own
 * rendered root, not a click that started inside a descendant. */
export function isBackdropRootMousedown(target: EventTarget | null, hostEl: Element | null): boolean {
  if (!hostEl) return false;
  return target === hostEl.firstElementChild;
}

export interface SettingsHostProps {
  file: SettingsLayoutFile;
  isOpen?: boolean;
  onClose?: () => void;
  outlets?: Record<string, ReactNode>;
  renderElement?: (node: HostNode) => ReactNode;
  settings?: SettingsValues;
  themeId?: string;
}

export function SettingsHost({
  file,
  isOpen = true,
  onClose,
  outlets,
  renderElement,
  settings,
  themeId = "",
}: SettingsHostProps) {
  const presentation = file.presentation ?? { mode: "overlay" };
  const mode = presentation.mode;
  const root = useResolvedRoot(file);
  useLayoutCollapseRules(root);

  useEscapeLayer(isOpen && mode === "overlay" && !!onClose, () => onClose?.());

  const hostRef = useRef<HTMLDivElement>(null);
  const backdropClose = mode === "overlay" && presentation.backdropClose === true;

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (backdropClose && onClose && isBackdropRootMousedown(e.target, hostRef.current)) {
      onClose();
    }
  };

  if (!isOpen) return null;

  let style: CSSProperties;

  if (mode === "panel") {
    style = { display: "contents" };
  } else if (mode === "overlay") {
    style = {
      position: "absolute",
      inset: 0,
      zIndex: "var(--z-settings)",
      width: "100%",
      height: "100%",
    };
  } else {
    style = {
      width: "100%",
      height: "100%",
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
      ref={hostRef}
      data-settings-host=""
      data-presentation={mode}
      data-region={presentation.region}
      style={style}
      onMouseDown={backdropClose ? onMouseDown : undefined}
    >
      <RenderContextProvider value={renderCtx}>
        <LayoutNodeRenderer node={root} />
      </RenderContextProvider>
    </div>
  );
}

/** Portals `overlay`/`panel` Settings into their named region; `view` mode
 * replaces an outlet and stays with the caller. The region belongs to a
 * sibling tree, so it is looked up in the DOM and again whenever the DOM changes. */
export function SettingsRegionPortal(props: SettingsHostProps) {
  const { file, isOpen = true } = props;
  const presentation = file.presentation ?? { mode: "overlay" };
  const mode = presentation.mode;
  const regionId = presentation.region;
  const active = isOpen && mode !== "view";

  const [regionNode, setRegionNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !regionId) {
      setRegionNode(null);
      return;
    }
    const find = () => document.querySelector<HTMLElement>(`[data-region="${regionId}"]`);
    let current = find();
    setRegionNode(current);
    // Only search again once the region found last has gone; list rows mount and
    // unmount all the time while Settings is open.
    const observer = new MutationObserver(() => {
      if (current?.isConnected && current.dataset.region === regionId) return;
      current = find();
      setRegionNode(current);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-region"],
    });
    return () => {
      observer.disconnect();
      setRegionNode(null);
    };
  }, [active, regionId]);

  useEffect(() => {
    if (!regionNode || mode !== "overlay") return;
    const prevPosition = regionNode.style.position;
    regionNode.style.position = "relative";
    return () => {
      regionNode.style.position = prevPosition;
    };
  }, [regionNode, mode]);

  if (!active || !regionNode) return null;

  return createPortal(<SettingsHost {...props} />, regionNode);
}
