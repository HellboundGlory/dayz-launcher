import {
  useContext,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { CommonProps } from "../renderer/types";
import { RenderContext } from "../renderer/node-renderer";
import { getPersistedSize, setPersistedSize } from "./store";

export function parseLengthPx(val: string | undefined, defaultVal: number): number {
  if (!val) return defaultVal;
  const match = val.match(/^(\d+(?:\.\d+)?)px$/);
  return match ? parseFloat(match[1]) : defaultVal;
}

export function handleResizeKey({
  key,
  edge,
  current,
  min,
  max,
  step = 8,
}: {
  key: string;
  edge: "left" | "right" | "top" | "bottom";
  current: number;
  min: number;
  max: number;
  step?: number;
}): number | null {
  let next = current;

  if (key === "Home") {
    next = min;
  } else if (key === "End") {
    next = max;
  } else if (edge === "right") {
    if (key === "ArrowRight") next = current + step;
    else if (key === "ArrowLeft") next = current - step;
    else return null;
  } else if (edge === "left") {
    if (key === "ArrowLeft") next = current + step;
    else if (key === "ArrowRight") next = current - step;
    else return null;
  } else if (edge === "bottom") {
    if (key === "ArrowDown") next = current + step;
    else if (key === "ArrowUp") next = current - step;
    else return null;
  } else if (edge === "top") {
    if (key === "ArrowUp") next = current + step;
    else if (key === "ArrowDown") next = current - step;
    else return null;
  } else {
    return null;
  }

  return Math.max(min, Math.min(max, next));
}

interface RegionSizeState {
  key: string;
  size: string | undefined;
}

export function reseedRegionSize(
  state: RegionSizeState,
  key: string,
  read: () => string | undefined,
): RegionSizeState {
  return state.key === key ? state : { key, size: read() };
}

export function useRegionSize(
  node: CommonProps,
  themeId: string,
): [string | undefined, (size: string) => void] {
  const regionId = node.resizable ? node.id : undefined;
  const key = regionId ? `${themeId}|${regionId}` : "";
  const read = () => (regionId ? getPersistedSize(themeId, regionId) : undefined);
  const [state, setState] = useState<RegionSizeState>(() => ({ key, size: read() }));
  const current = reseedRegionSize(state, key, read);
  if (current !== state) setState(current);
  return [current.size, (size) => setState({ key, size })];
}

export function ResizableHandle({
  node,
  size,
  onSizeChange,
}: {
  node: CommonProps;
  size: string | undefined;
  onSizeChange: (size: string) => void;
}) {
  const themeCtx = useContext(RenderContext);
  const resizable = node.resizable;
  const edge = resizable?.edge ?? "right";
  const isVertical = edge === "left" || edge === "right";
  const regionId = node.id ?? "";

  const min = parseLengthPx(resizable?.min, 100);
  const max = parseLengthPx(resizable?.max, 800);
  const defaultSize = parseLengthPx(
    isVertical ? node.width : node.height,
    Math.min(max, Math.max(min, 240)),
  );
  const current = parseLengthPx(size, defaultSize);

  if (!resizable) return null;

  const updateSize = (next: number) => {
    const clamped = Math.max(min, Math.min(max, next));
    const sizeStr = `${clamped}px`;
    onSizeChange(sizeStr);
    return sizeStr;
  };

  const persistSize = (sizeStr: string) => {
    if (regionId) {
      setPersistedSize(themeCtx.themeId, regionId, sizeStr);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = handleResizeKey({
      key: e.key,
      edge,
      current,
      min,
      max,
    });
    if (next !== null) {
      e.preventDefault();
      persistSize(updateSize(next));
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (typeof window === "undefined") return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = current;
    let latest: string | undefined;

    const onPointerMove = (ev: globalThis.PointerEvent) => {
      let delta = 0;
      if (edge === "right") delta = ev.clientX - startX;
      else if (edge === "left") delta = startX - ev.clientX;
      else if (edge === "bottom") delta = ev.clientY - startY;
      else if (edge === "top") delta = startY - ev.clientY;
      latest = updateSize(startSize + delta);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (latest) persistSize(latest);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const style: CSSProperties = {
    position: "absolute",
    zIndex: 10,
    touchAction: "none",
    userSelect: "none",
    ...(edge === "right" && {
      right: 0,
      top: 0,
      bottom: 0,
      width: "6px",
      cursor: "col-resize",
    }),
    ...(edge === "left" && {
      left: 0,
      top: 0,
      bottom: 0,
      width: "6px",
      cursor: "col-resize",
    }),
    ...(edge === "bottom" && {
      bottom: 0,
      left: 0,
      right: 0,
      height: "6px",
      cursor: "row-resize",
    }),
    ...(edge === "top" && {
      top: 0,
      left: 0,
      right: 0,
      height: "6px",
      cursor: "row-resize",
    }),
  };

  return (
    <div
      data-part="resize-handle"
      data-edge={edge}
      role="separator"
      tabIndex={0}
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-valuenow={current}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={node.id ? `Resize ${node.id}` : "Resize"}
      style={style}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}
