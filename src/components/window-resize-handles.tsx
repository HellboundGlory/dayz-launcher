import { getCurrentWindow } from "@tauri-apps/api/window";

// Same values `ResizeDirection` resolves to, but the API package does not
// re-export the type from its module root.
type ResizeDir = "East" | "North" | "NorthEast" | "NorthWest" | "South"
  | "SouthEast" | "SouthWest" | "West";

const HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: "North", className: "left-2 right-2 top-0 h-1 cursor-n-resize" },
  { dir: "South", className: "bottom-0 left-2 right-2 h-1 cursor-s-resize" },
  { dir: "East", className: "right-0 top-2 bottom-2 w-1 cursor-e-resize" },
  { dir: "West", className: "left-0 top-2 bottom-2 w-1 cursor-w-resize" },
  { dir: "NorthWest", className: "left-0 top-0 size-2 cursor-nw-resize" },
  { dir: "NorthEast", className: "right-0 top-0 size-2 cursor-ne-resize" },
  { dir: "SouthWest", className: "bottom-0 left-0 size-2 cursor-sw-resize" },
  { dir: "SouthEast", className: "bottom-0 right-0 size-2 cursor-se-resize" },
];

/**
 * Invisible drag handles along the window edges and corners.
 *
 * Undecorated windows get edge-resize for free on Windows (the OS hit-tests
 * the frame), but on Linux/X11-Wayland there is nothing to grab. Tauri's
 * `startResizeDragging` lets us trigger the native resize from these
 * pointer-event zones, giving resize parity on every platform.
 */
export function WindowResizeHandles() {
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.dir}
          className={`pointer-events-auto fixed z-50 ${h.className}`}
          onMouseDown={(e) => {
            e.preventDefault();
            getCurrentWindow().startResizeDragging(h.dir).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
