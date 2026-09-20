import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { HostNode, SettingsLayoutFile } from "../renderer/types";
import { type SettingsValues } from "../renderer/props";
import { LayoutNodeRenderer, RenderContextProvider } from "../renderer/node-renderer";

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

  useEffect(() => {
    if (!isOpen || mode !== "overlay" || !onClose || typeof window === "undefined") return;

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, mode, onClose]);

  if (!isOpen) return null;

  let style: CSSProperties = {
    width: "100%",
    height: "100%",
  };

  if (mode === "overlay") {
    style = {
      position: "absolute",
      inset: 0,
      zIndex: 30,
      ...style,
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
      data-settings-host=""
      data-presentation={mode}
      data-region={presentation.region}
      style={style}
    >
      <RenderContextProvider value={renderCtx}>
        <LayoutNodeRenderer node={file.root} />
      </RenderContextProvider>
    </div>
  );
}

/** Portals `overlay`/`panel` Settings into their named region; `view` mode
 * replaces an outlet and stays with the caller. The region belongs to a
 * sibling tree, so it is resolved after paint rather than on first render. */
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
    let frame = 0;
    // A region a theme names but never renders must not spin a frame loop forever.
    let attempts = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-region="${regionId}"]`);
      if (el) {
        setRegionNode(el);
      } else if (attempts < 120) {
        attempts += 1;
        frame = requestAnimationFrame(find);
      }
    };
    find();
    return () => {
      cancelAnimationFrame(frame);
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
