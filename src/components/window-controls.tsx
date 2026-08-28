import { Minus, Square, X } from "lucide-react";

/**
 * The frameless window's min/max/close cluster.
 *
 * The locked board omits window controls (its window is a decoration-free
 * mock), but the real window is `decorations: false` — without these buttons
 * the launcher would be uncloseable. Kept as a slim strip at the top-right of
 * the main area; the strip doubles as the drag region, and the sidebar's brand
 * strip carries `data-tauri-drag-region` too. Deliberate exception to the
 * board, recorded in DESIGN.md §19.
 */
export function WindowControls() {
  function minimizeWindow() {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().minimize())
      .catch(() => {});
  }
  function maximizeWindow() {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
      .catch(() => {});
  }
  function closeWindow() {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().close())
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
