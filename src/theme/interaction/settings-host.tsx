import { useEffect, type CSSProperties, type ReactNode } from "react";
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
