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

  return (
    <div
      data-tauri-drag-region
      className="flex h-7 shrink-0 select-none items-center justify-end border-b border-line bg-surface"
    >
      <button
        onClick={minimizeWindow}
        title="Minimize"
        aria-label="Minimize"
        className="inline-flex h-7 w-[40px] items-center justify-center text-muted transition-colors hover:bg-surface2 hover:text-ink"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={maximizeWindow}
        title="Maximize"
        aria-label="Maximize"
        className="inline-flex h-7 w-[40px] items-center justify-center text-muted transition-colors hover:bg-surface2 hover:text-ink"
      >
        <Square className="size-3" />
      </button>
      <button
        onClick={closeWindow}
        title="Close"
        aria-label="Close"
        className="inline-flex h-7 w-[40px] items-center justify-center text-muted transition-colors hover:bg-danger hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
