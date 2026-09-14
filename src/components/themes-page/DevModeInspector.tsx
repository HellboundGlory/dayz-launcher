import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { SLOTS } from "@/theme/slots";
import { LayoutEditPopover } from "./LayoutEditPopover";

const SLOT_ATTR = "data-tetra-slot";
const EL_ATTR = "data-tetra-el";

export interface TetraNode {
  /** Read at match time — the attribute value may be rebound in place. */
  id: string;
  kind: "slot" | "el";
  element: Element;
}

/** Nearest ancestor (or the element itself) carrying a `data-tetra-slot` or
 * `data-tetra-el` attribute; `null` when the walk reaches the document. The one
 * element carrying both (`shell.header`, whose drag region is also its own
 * child) reports the slot: the container is the themable unit, and taking the
 * child there would make every other slot's container area report a child
 * instead. */
export function findTetraNode(start: Element | null): TetraNode | null {
  for (let node = start; node !== null; node = node.parentElement) {
    if (node.hasAttribute(SLOT_ATTR)) {
      return { id: node.getAttribute(SLOT_ATTR) ?? "", kind: "slot", element: node };
    }
    if (node.hasAttribute(EL_ATTR)) {
      return { id: node.getAttribute(EL_ATTR) ?? "", kind: "el", element: node };
    }
  }
  return null;
}

/** The attribute selector that selects exactly the tagged markup. */
export function selectorFor(node: TetraNode): string {
  const attr = node.kind === "slot" ? SLOT_ATTR : EL_ATTR;
  // Registry ids are plain ASCII; CSS.escape is absent in older webviews.
  const id =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(node.id)
      : node.id.replace(/["\\]/g, "\\$&");
  return `[${attr}="${id}"]`;
}

interface HoverState {
  node: TetraNode;
  rect: DOMRect;
}

const BADGE_MAX_W = 336;

// How far past an anchor's edge a floating panel sits (see `placeOverlay`
// below, which positions it this far below or above).
const BADGE_GAP = 8;

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Whether `(x, y)` sits in the corridor between a hovered element and its
 * floating badge, so crossing that gap doesn't hand the hover to whatever's
 * actually behind it. Horizontally uses the overlap between the two rects,
 * not their union — a full-width row paired with a much narrower badge would
 * otherwise protect the entire row instead of just the doorway to the badge. */
export function inHoverBridge(
  x: number,
  y: number,
  anchor: { top: number; bottom: number; left: number; right: number },
  badge: { top: number; bottom: number; left: number; right: number },
): boolean {
  const overlapLeft = Math.max(anchor.left, badge.left);
  const overlapRight = Math.min(anchor.right, badge.right);
  const left = overlapLeft < overlapRight ? overlapLeft : badge.left;
  const right = overlapLeft < overlapRight ? overlapRight : badge.right;
  if (x < left || x > right) return false;
  const top = Math.min(anchor.top, anchor.bottom, badge.top, badge.bottom);
  const bottom = Math.max(anchor.top, anchor.bottom, badge.top, badge.bottom);
  return y >= top && y <= bottom;
}

/** Top/left for a floating panel measured at `size`, sitting just past
 * `anchor`'s bottom edge when there is room and just above it otherwise. The
 * badge and the layout popover both hang off the highlighted element, so they
 * share this rather than clamping twice. */
export function placeOverlay(
  anchor: { top: number; bottom: number; left: number },
  size: { w: number; h: number },
): { top: number; left: number } {
  const margin = BADGE_GAP;
  const below = anchor.bottom + margin;
  return {
    top:
      below + size.h <= window.innerHeight - margin
        ? below
        : Math.max(margin, anchor.top - margin - size.h),
    left: Math.max(
      margin,
      Math.min(anchor.left, window.innerWidth - Math.min(size.w, BADGE_MAX_W) - margin),
    ),
  };
}

/** `shell.footer`'s current rect, fresh each call — it never moves, but the
 * list underneath it does not actually clip against it (see the mousemove
 * handler below), so anything reaching into this area is refused outright
 * rather than trusted. */
function footerRect(): DOMRect | null {
  return document.querySelector(`[${SLOT_ATTR}="shell.footer"]`)?.getBoundingClientRect() ?? null;
}

/** The same "is this a real, inspectable target" rule used for both live
 * hover tracking and click-to-pin, so the two can never disagree about what
 * counts as valid. */
function resolveDevTarget(target: Element): { node: TetraNode; rect: DOMRect } | null {
  const node = findTetraNode(target);
  if (node === null) return null;
  const rect = node.element.getBoundingClientRect();
  const footer = footerRect();
  const isFooterItself = node.element.closest(`[${SLOT_ATTR}="shell.footer"]`) !== null;
  const isOverlaySurface = node.element.closest(`[${SLOT_ATTR}="settings.background"]`) !== null;
  const isViewContainerItself =
    node.id === "view.servers" ||
    node.id === "view.favourites" ||
    node.id === "view.recent" ||
    node.id === "view.mods";
  const valid =
    isFooterItself || isOverlaySurface || isViewContainerItself || footer === null || !rectsOverlap(rect, footer);
  return valid ? { node, rect } : null;
}

/** Slot inspector: outlines whatever slot/element the pointer is over and
 * reports the registry's children for it. With `editMode`, a slot's badge
 * also offers the reorder/hide popover. Mounted only while Dev Mode is on, so
 * the listeners and the overlay exist for exactly that long. */
export function DevModeInspector({ editMode }: { editMode: boolean }) {
  const [hover, setHover] = useState<HoverState | null>(null);
  // Freezes the badge on a clicked target regardless of subsequent mouse
  // movement; another click, empty space, Escape, or scroll releases it.
  const [pinned, setPinned] = useState<HoverState | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // The slot the layout popover is open for; anchored to the badge rather
  // than the highlighted element so it doesn't land on the button that
  // opened it. Hover tracking pauses while set (see `onMove`).
  const [editSlot, setEditSlot] = useState<{ id: string; anchor: DOMRect } | null>(null);
  // Keyed on the rounded rect too, so a layout shift under a stationary pointer
  // re-positions the outline while an unchanged hover skips the re-render.
  const lastKey = useRef<string | null>(null);
  // Mirrors `hover`/`pinned` for the mousemove/click listeners below, which are
  // attached once and would otherwise only ever see the value from their first
  // render.
  const hoverRef = useRef<HoverState | null>(null);
  hoverRef.current = hover;
  const pinnedRef = useRef<HoverState | null>(null);
  pinnedRef.current = pinned;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const editSlotRef = useRef<string | null>(null);
  editSlotRef.current = editSlot?.id ?? null;
  const badgeRef = useRef<HTMLDivElement | null>(null);

  // What's actually shown: a pin overrides live hover entirely, so the badge
  // is stable while the pointer crosses to it.
  const active = pinned ?? hover;

  // `hover` doesn't update while pinned (see `onMove`), so it can be
  // arbitrarily stale by release time — clear it too, or `active` briefly
  // falls back to whatever was hovered before the pin was set.
  const releasePin = useCallback(() => {
    setPinned(null);
    setHover(null);
    lastKey.current = null;
  }, []);

  // Re-measures the pinned element every frame rather than trusting the rect
  // captured at click time, so it tracks a resize or reflow underneath it.
  // Only runs while pinned, and unpins on its own if the element leaves the
  // document (e.g. hidden via the layout popover).
  useEffect(() => {
    if (pinned === null) return;
    let raf = 0;
    function tick() {
      setPinned((current) => {
        if (current === null) return current;
        if (!document.contains(current.node.element)) {
          // Same cleanup as `releasePin` — this exit bypasses it.
          setHover(null);
          lastKey.current = null;
          return null;
        }
        const rect = current.node.element.getBoundingClientRect();
        if (
          rect.top === current.rect.top &&
          rect.left === current.rect.left &&
          rect.width === current.rect.width &&
          rect.height === current.rect.height
        ) {
          return current;
        }
        return { ...current, rect };
      });
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Only needs to start/stop when pin state toggles — `tick` re-reads
    // `current` fresh from the updater on every frame regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned === null]);

  // Records what was clicked; never blocks or alters the click itself (no
  // preventDefault/stopPropagation), so every button, tab and dropdown in the
  // app keeps working exactly as it did before Dev Mode existed — this only
  // ever adds a badge on top of whatever the click already did.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Clicks inside the badge or the layout popover manage pin/edit state
      // themselves (Copy, Edit order, its own outside-click handler) — must
      // not also be reinterpreted as "click elsewhere" here.
      if (target.closest("[data-dev-inspector]")) return;
      if (editSlotRef.current !== null) return;
      const resolved = resolveDevTarget(target);
      setCopyState("idle");
      if (resolved === null) {
        releasePin();
        return;
      }
      if (pinnedRef.current !== null && pinnedRef.current.node.element === resolved.node.element) {
        releasePin();
        return;
      }
      setPinned(resolved);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [releasePin]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (editSlotRef.current !== null) return;
      // A pin freezes the badge on its own target; live hover no longer has
      // any say in what's displayed until it's released.
      if (pinnedRef.current !== null) return;
      // Checked by coordinates, not `e.target.closest()`: most of the badge
      // has no `pointer-events` override (so a real click falls through to
      // whatever's behind it), which means the browser's hit-test for
      // hover/move skips it too — `e.target` over blank badge space is
      // whatever's behind it, not the badge.
      const badgeRect = badgeRef.current?.getBoundingClientRect();
      if (
        badgeRect !== undefined &&
        e.clientX >= badgeRect.left &&
        e.clientX <= badgeRect.right &&
        e.clientY >= badgeRect.top &&
        e.clientY <= badgeRect.bottom
      ) {
        return;
      }
      // Its own outline and the badge's own buttons — reaching for either
      // must not blank the readout "Copy selector" is about to act on.
      if (target.closest("[data-dev-inspector]")) return;
      const resolved = resolveDevTarget(target);
      if (resolved === null) {
        // Genuinely blank space on the way to the current hover's own badge
        // (see `inHoverBridge`) still holds it open — gated to the case an
        // "Edit order" button exists, since that's the only thing worth
        // reaching by mouse (Ctrl+C already covers Copy).
        const currentHover = hoverRef.current;
        const currentSlotEligible =
          editModeRef.current &&
          currentHover !== null &&
          currentHover.node.kind === "slot" &&
          (SLOTS.find((s) => s.id === currentHover.node.id)?.children.length ?? 0) > 1;
        const badgeRect = badgeRef.current?.getBoundingClientRect();
        if (
          currentSlotEligible &&
          currentHover !== null &&
          badgeRect !== undefined &&
          inHoverBridge(e.clientX, e.clientY, currentHover.rect, badgeRect)
        ) {
          return;
        }
        if (lastKey.current === "") return;
        lastKey.current = "";
        setHover(null);
        setCopyState("idle");
        return;
      }
      const { node, rect } = resolved;
      const key = `${node.kind}:${node.id}:${Math.round(rect.top)},${Math.round(rect.left)},${Math.round(rect.width)},${Math.round(rect.height)}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      setHover({ node, rect });
      setCopyState("idle");
    }
    function onOut(e: MouseEvent) {
      if (e.relatedTarget !== null) return;
      if (editSlotRef.current !== null) return;
      lastKey.current = null;
      setHover(null);
      setCopyState("idle");
    }
    // Scrolling moves whatever's under a stationary pointer without firing
    // mousemove, and a virtualised list can reuse the same DOM node for a
    // different row — clear on any scroll (capture: true, scroll doesn't
    // bubble) so the next mousemove picks up wherever the pointer lands.
    function onScroll() {
      if (editSlotRef.current !== null) return;
      // A pin re-measures every frame regardless of scroll, but can't detect
      // a virtualised list reusing its DOM node for a different row — drop
      // it too rather than risk labeling the wrong one.
      if (pinnedRef.current !== null) {
        releasePin();
        return;
      }
      if (lastKey.current === null) return;
      lastKey.current = null;
      setHover(null);
      setCopyState("idle");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [releasePin]);

  // Leaving edit mode leaves any open popover with it — it doesn't render
  // while off, and turning it back on should start from a clean slate rather
  // than an old target reappearing.
  useEffect(() => {
    if (!editMode) setEditSlot(null);
  }, [editMode]);

  const copyResetTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    };
  }, []);

  async function copySelector(node: TetraNode) {
    if (copyResetTimer.current !== null) window.clearTimeout(copyResetTimer.current);
    try {
      await navigator.clipboard.writeText(selectorFor(node));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    copyResetTimer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  }

  // Ctrl/Cmd+C copies the pinned (or, absent a pin, hovered) selector without
  // needing to reach the badge's own button. Escape releases a pin the same
  // way clicking empty space would.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && editSlotRef.current === null) {
        releasePin();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
      const node = pinnedRef.current?.node ?? hoverRef.current?.node;
      if (!node) return;
      e.preventDefault();
      void copySelector(node);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [releasePin]);

  const slot =
    active !== null && active.node.kind === "slot"
      ? SLOTS.find((s) => s.id === active.node.id)
      : undefined;
  const required = slot?.children.filter((c) => c.required) ?? [];
  const optional = slot?.children.filter((c) => !c.required) ?? [];
  const { rect } = active ?? {};

  // The badge is measured rather than guessed: a full-height slot (the sidebar)
  // has no room below it, and a tall element's badge must not land off-screen.
  const [badge, setBadge] = useState({ w: BADGE_MAX_W, h: 0 });
  useLayoutEffect(() => {
    const el = badgeRef.current;
    if (el === null) return;
    setBadge({ w: el.offsetWidth, h: el.offsetHeight });
  }, [active, copyState]);

  const { top, left } = rect ? placeOverlay(rect, badge) : { top: 0, left: BADGE_GAP };

  return createPortal(
    <div data-dev-inspector className="pointer-events-none fixed inset-0 z-[400]">
      {active && rect && (
        <>
          <div
            data-dev-inspector
            className="absolute rounded-[3px] border-2 border-[#ff4fd8] bg-[rgba(255,79,216,0.12)]"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
          <div
            ref={badgeRef}
            data-dev-inspector
            // Not pointer-events-auto here: the badge can land over real
            // content behind it, so only the two buttons below opt back in —
            // everything else stays click-through.
            className="absolute overflow-auto rounded-[6px] border border-[#ff4fd8] bg-[rgba(12,10,16,0.95)] px-2.5 py-2 font-mono-data text-[10px] leading-[1.5] text-[#e9e6f2] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            style={{
              top,
              left,
              maxWidth: `min(${BADGE_MAX_W}px, calc(100vw - 16px))`,
              maxHeight: "70vh",
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="rounded-[3px] bg-[rgba(255,79,216,0.25)] px-1 py-px text-[9px] font-bold uppercase tracking-[0.04em] text-[#ff9ae8]">
                {active.node.kind === "slot" ? "slot" : "el"}
              </span>
              <span className="break-all font-semibold text-[#ffd7f6]">{active.node.id}</span>
              {pinned && (
                <span className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.04em] text-[#9c93ad]">
                  pinned · click elsewhere or Esc
                </span>
              )}
            </div>

            {active.node.kind === "slot" && (
              <div className="mt-1.5 flex flex-col gap-0.5">
                {!slot && <span className="text-[#ff9ae8]">not in the SLOTS registry</span>}
                {(["required", "optional"] as const).map((group) => {
                  const ids = (group === "required" ? required : optional).map((c) => c.id);
                  return (
                    <div key={group}>
                      <span className="uppercase tracking-[0.04em] text-[#9c93ad]">{group}</span>
                      <span className="ml-1.5">{ids.length > 0 ? ids.join(", ") : "—"}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copySelector(active.node)}
                className={cn(
                  "pointer-events-auto shrink-0 rounded-[4px] border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.04em]",
                  copyState === "failed"
                    ? "border-danger text-danger"
                    : copyState === "copied"
                      ? "border-[#ff4fd8] bg-[rgba(255,79,216,0.2)] text-[#ff9ae8]"
                      : "border-[#ff4fd8] text-[#ff9ae8] hover:bg-[rgba(255,79,216,0.2)]",
                )}
              >
                {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : "Ctrl+C to copy"}
              </button>
              <span className="break-all text-[#9c93ad]">{selectorFor(active.node)}</span>
              {editMode && slot !== undefined && slot.children.length > 1 && (
                <button
                  type="button"
                  // Without this, closing the popover here reopens it: its
                  // outside-mousedown handler (mousedown fires before click)
                  // would clear `editSlot` first, so `open` already reads
                  // null by the time the onClick below runs.
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    setEditSlot((open) =>
                      open?.id === active.node.id
                        ? null
                        : { id: active.node.id, anchor: badgeRef.current?.getBoundingClientRect() ?? rect },
                    )
                  }
                  className="pointer-events-auto ml-auto shrink-0 rounded-[4px] border border-[#ff4fd8] px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.04em] text-[#ff9ae8] hover:bg-[rgba(255,79,216,0.2)]"
                >
                  Edit order
                </button>
              )}
            </div>
          </div>
        </>
      )}
      {editMode && editSlot && (
        <LayoutEditPopover
          slotId={editSlot.id}
          anchorRect={editSlot.anchor}
          onClose={() => setEditSlot(null)}
        />
      )}
    </div>,
    document.body,
  );
}
