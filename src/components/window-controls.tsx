import { Fragment } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// The frameless window's min/max/close cluster — needed since decorations:
// false leaves no OS-provided way to close the window. Also doubles as the drag region.
export function WindowControls() {
  function minimizeWindow() {
    getCurrentWindow()
      .minimize()
      .catch(() => {});
  }
  function maximizeWindow() {
    getCurrentWindow()
      .toggleMaximize()
      .catch(() => {});
  }
  function closeWindow() {
    getCurrentWindow()
      .close()
      .catch(() => {});
  }

  // One registry id covers the whole cluster, not one per button.
  const windowControls = (
    <Fragment>
      <button
        onClick={minimizeWindow}
        title="Minimize"
        aria-label="Minimize"
        data-tetra-el="windowControls"
        className="inline-flex h-[var(--t-space-windowControlHeight)] w-[var(--t-space-windowControlWidth)] items-center justify-center text-muted transition-colors [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] hover:bg-surface2 hover:text-ink"
      >
        <Minus className="size-[var(--t-space-iconMedium)]" />
      </button>
      <button
        onClick={maximizeWindow}
        title="Maximize"
        aria-label="Maximize"
        data-tetra-el="windowControls"
        className="inline-flex h-[var(--t-space-windowControlHeight)] w-[var(--t-space-windowControlWidth)] items-center justify-center text-muted transition-colors [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] hover:bg-surface2 hover:text-ink"
      >
        <Square className="size-[var(--t-space-iconSmall)]" />
      </button>
      <button
        onClick={closeWindow}
        title="Close"
        aria-label="Close"
        data-tetra-el="windowControls"
        className="inline-flex h-[var(--t-space-windowControlHeight)] w-[var(--t-space-windowControlWidth)] items-center justify-center text-muted transition-colors [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] hover:bg-danger hover:text-ink"
      >
        <X className="size-[var(--t-space-iconMedium)]" />
      </button>
    </Fragment>
  );

  return (
    <div
      data-tetra-el="dragRegion"
      data-tauri-drag-region
      className="flex h-[var(--t-space-windowControlHeight)] shrink-0 select-none items-center justify-end border-b border-line bg-surface"
    >
      {windowControls}
    </div>
  );
}
