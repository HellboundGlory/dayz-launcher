import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, GripVertical, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLOTS } from "@/theme/slots";
import { resolveLayout } from "@/theme/layout-store";
import { useThemeStore } from "@/theme/theme-store";
import { dropIndexFor, moveItem, orderWithHidden, type RowRect } from "./layout-drag";
import { placeOverlay } from "./DevModeInspector";

export interface LayoutEditPopoverProps {
  slotId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

const ROW_BTN =
  "shrink-0 rounded-[3px] p-0.5 text-[#9c93ad] transition-colors hover:text-[#ff9ae8] disabled:cursor-not-allowed disabled:opacity-50";

/** The slot's children as an editable list: drag a row by its grip to reorder,
 * click an eye to hide or show it. Anchored to the badge that opened it, which
 * is why it takes a rect rather than tracking the pointer itself. */
export function LayoutEditPopover({ slotId, anchorRect, onClose }: LayoutEditPopoverProps) {
  const layout = useThemeStore((s) => s.themeFiles[s.activeId]?.layout);
  const reorderSlotChildren = useThemeStore((s) => s.reorderSlotChildren);
  const toggleSlotChildVisibility = useThemeStore((s) => s.toggleSlotChildVisibility);

  // Read live from the store, not a prop snapshot: a hot-reload of this same
  // theme while the popover is open must be what the next drag reorders.
  const resolved = resolveLayout(SLOTS, layout).resolved[slotId];
  const slot = SLOTS.find((s) => s.id === slotId);
  const registryOrder = slot?.children.map((child) => child.id) ?? [];
  const ids = orderWithHidden(
    resolved?.children ?? registryOrder,
    resolved?.hidden ?? [],
    registryOrder,
  );
  const rowCount = ids.length;

  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [size, setSize] = useState({ w: 220, h: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The rows as they were when the drag started: they are reordered under the
  // pointer for feedback, so live rects would make the target chase itself.
  const rowRects = useRef<RowRect[]>([]);
  // `onClose` is an inline arrow at the call site; a ref keeps the listeners
  // bound once rather than re-registered on every drag frame.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const shown = drag ? moveItem(ids, drag.from, drag.to) : ids;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [layout, rowCount]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      closeRef.current();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  /** Starts a drag from a row's grip. Uses plain document-level
   * `mousemove`/`mouseup`, not Pointer Events capture — WebKitGTK's capture
   * support is unreliable once the pointer moves off the capturing element,
   * which reordering does as rows shift under it. */
  function startDrag(e: React.MouseEvent<HTMLButtonElement>) {
    const row = e.currentTarget.closest("[data-layout-row]");
    const index = Array.from(listRef.current?.children ?? []).indexOf(row as Element);
    if (index === -1) return;
    e.preventDefault();
    // The rows as they are now, in this list's own order: the pointer is mapped
    // against these rects for the whole drag, so moving a row for feedback
    // cannot make the drop target chase itself.
    rowRects.current = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-layout-row]") ?? [],
      (el) => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      },
    );
    setDrag({ from: index, to: index });
  }

  function endDrag(commit: boolean) {
    setDrag((current) => {
      if (current === null) return current;
      const order = moveItem(ids, current.from, current.to);
      // Committed once, on release, never per move: each store call is a disk
      // write plus a revert window, so intermediate positions must not reach it.
      // A drag that lands where it started is no edit at all.
      if (commit && order.some((id, index) => id !== ids[index])) {
        void reorderSlotChildren(slotId, order);
      }
      return null;
    });
  }

  // Attached only while a drag is in progress, and re-attached fresh on every
  // `drag` change (there are at most a handful of moves in one reorder, so
  // the churn costs nothing) — closing over a stale `drag`/`ids` here is
  // exactly the bug a listener bound once at mount would have.
  useEffect(() => {
    if (drag === null) return;
    function onMove(e: MouseEvent) {
      const to = dropIndexFor(e.clientY, rowRects.current);
      if (drag !== null && to !== drag.to) setDrag({ ...drag, to });
    }
    function onUp() {
      endDrag(true);
    }
    function onCancel() {
      endDrag(false);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // Losing window focus mid-drag (alt-tab, a native dialog) leaves the
    // mouseup that would normally end it firing somewhere else entirely.
    window.addEventListener("blur", onCancel);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onCancel);
    };
    // `endDrag` is intentionally excluded: it's redefined every render, and
    // this effect already re-attaches on every `drag` change (its own
    // dependency) — always picking up that render's fresh `endDrag`/`ids`
    // closure without needing a second trigger for the same thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const { top, left } = placeOverlay(anchorRect, size);

  return createPortal(
    <div
      ref={rootRef}
      data-dev-inspector
      className="pointer-events-auto fixed z-[401] w-[220px] overflow-auto rounded-[6px] border border-[#ff4fd8] bg-[rgba(12,10,16,0.95)] px-2 py-1.5 font-mono-data text-[10px] leading-[1.5] text-[#e9e6f2] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      style={{ top, left, maxWidth: "calc(100vw - 16px)", maxHeight: "70vh" }}
    >
      <div className="flex items-center gap-1.5">
        <span className="rounded-[3px] bg-[rgba(255,79,216,0.25)] px-1 py-px text-[9px] font-bold uppercase tracking-[0.04em] text-[#ff9ae8]">
          order
        </span>
        <span className="min-w-0 flex-1 break-all font-semibold text-[#ffd7f6]">{slotId}</span>
      </div>

      <div ref={listRef} className="mt-1.5 flex flex-col gap-0.5">
        {shown.map((childId, index) => {
          const required = slot?.children.find((child) => child.id === childId)?.required ?? false;
          const hidden = resolved?.hidden.includes(childId) ?? false;
          return (
            <div
              key={childId}
              data-layout-row
              className={cn(
                "flex items-center gap-1.5 rounded-[4px] px-1 py-0.5",
                drag !== null && index === drag.to && "bg-[rgba(255,79,216,0.2)]",
              )}
            >
              <button
                type="button"
                title="Drag to reorder"
                className={cn(ROW_BTN, "cursor-grab touch-none")}
                onMouseDown={startDrag}
              >
                <GripVertical className="size-3" />
              </button>
              <span className={cn("min-w-0 flex-1 break-all", hidden && "text-[#9c93ad]")}>
                {childId}
              </span>
              {required ? (
                <span title="Required — cannot be hidden" className={cn(ROW_BTN, "cursor-default")}>
                  <Lock className="size-3" />
                </span>
              ) : (
                <button
                  type="button"
                  title={hidden ? `Show ${childId}` : `Hide ${childId}`}
                  className={ROW_BTN}
                  onClick={() => void toggleSlotChildVisibility(slotId, childId)}
                >
                  {hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
