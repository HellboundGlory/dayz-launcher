import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { SLOTS } from "@/theme/slots";

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

// The gap between a highlighted element and its floating badge (see `margin`
// below, which positions the badge this far past the element's edge). The
// pointer crosses this gap on the way to "Copy selector"; `pointInRect`'s pad
// bridges it so the badge doesn't vanish out from under a reaching cursor.
const BADGE_GAP = 8;

function pointInRect(x: number, y: number, rect: DOMRect | null, pad: number): boolean {
  if (rect === null) return false;
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** `shell.footer`'s current rect, fresh each call — it never moves, but the
 * list underneath it does not actually clip against it (see the mousemove
 * handler below), so anything reaching into this area is refused outright
 * rather than trusted. */
function footerRect(): DOMRect | null {
  return document.querySelector(`[${SLOT_ATTR}="shell.footer"]`)?.getBoundingClientRect() ?? null;
}

/** Read-only slot inspector: outlines whatever slot/element the pointer is over
 * and reports the registry's children for it. Mounted only while Dev Mode is
 * on, so the listener and the overlay exist for exactly that long. */
export function DevModeInspector() {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // Keyed on the rounded rect too, so a layout shift under a stationary pointer
  // re-positions the outline while an unchanged hover skips the re-render.
  const lastKey = useRef<string | null>(null);
  // Mirrors `hover` for the mousemove listener below, which is attached once
  // and would otherwise only ever see the hover value from its first render.
  const hoverRef = useRef<HoverState | null>(null);
  hoverRef.current = hover;
  const badgeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Its own badge and outline, so reaching for "Copy selector" doesn't
      // blank the readout it is about to copy.
      if (target.closest("[data-dev-inspector]")) return;
      // The footer sits over the tail end of the (taller, unclipped) list
      // beneath it rather than actually cropping it — real content back
      // there can still be what the pointer hits. Refuse anything that
      // reaches into the footer's own area, even partially, unless the
      // match is the footer (or one of its own children) legitimately.
      const node = findTetraNode(target);
      const rect = node?.element.getBoundingClientRect() ?? null;
      const footer = footerRect();
      const isFooterItself = node !== null && node.element.closest(`[${SLOT_ATTR}="shell.footer"]`) !== null;
      const valid =
        node !== null && rect !== null && (isFooterItself || footer === null || !rectsOverlap(rect, footer));
      if (!valid) {
        // Nothing valid is directly under the pointer, but it may just be
        // crossing the gap toward the badge itself — bridge that gap rather
        // than dropping the badge before the pointer arrives.
        const bridging =
          pointInRect(e.clientX, e.clientY, hoverRef.current?.rect ?? null, BADGE_GAP) ||
          pointInRect(e.clientX, e.clientY, badgeRef.current?.getBoundingClientRect() ?? null, BADGE_GAP);
        if (bridging) return;
        if (lastKey.current === "") return;
        lastKey.current = "";
        setHover(null);
        setCopyState("idle");
        return;
      }
      const key = `${node.kind}:${node.id}:${Math.round(rect.top)},${Math.round(rect.left)},${Math.round(rect.width)},${Math.round(rect.height)}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      setHover({ node, rect });
      setCopyState("idle");
    }
    function onOut(e: MouseEvent) {
      if (e.relatedTarget !== null) return;
      lastKey.current = null;
      setHover(null);
      setCopyState("idle");
    }
    // Scrolling (the server list, a modal's body, ...) moves whatever is
    // under a stationary pointer without firing mousemove — and a virtualised
    // list reuses the same DOM node for a different row. Clearing on any
    // scroll (capture: true, since scroll doesn't bubble) means the badge
    // never keeps pointing at content that has moved or changed underneath
    // it; the next mousemove picks up wherever the pointer actually lands.
    function onScroll() {
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
  }, []);

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

  // Ctrl/Cmd+C copies the hovered selector — a floating badge that must be
  // clicked is a target chasing the pointer around; a key needs no reach.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
      const node = hoverRef.current?.node;
      if (!node) return;
      e.preventDefault();
      void copySelector(node);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const slot =
    hover !== null && hover.node.kind === "slot"
      ? SLOTS.find((s) => s.id === hover.node.id)
      : undefined;
  const required = slot?.children.filter((c) => c.required) ?? [];
  const optional = slot?.children.filter((c) => !c.required) ?? [];
  const { rect } = hover ?? {};

  // The badge is measured rather than guessed: a full-height slot (the sidebar)
  // has no room below it, and a tall element's badge must not land off-screen.
  const [badge, setBadge] = useState({ w: BADGE_MAX_W, h: 0 });
  useLayoutEffect(() => {
    const el = badgeRef.current;
    if (el === null) return;
    setBadge({ w: el.offsetWidth, h: el.offsetHeight });
  }, [hover, copyState]);

  const margin = BADGE_GAP;
  let top = 0;
  let left = margin;
  if (rect) {
    const below = rect.bottom + margin;
    top =
      below + badge.h <= window.innerHeight - margin
        ? below
        : Math.max(margin, rect.top - margin - badge.h);
    left = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - Math.min(badge.w, BADGE_MAX_W) - margin),
    );
  }

  return createPortal(
    <div data-dev-inspector className="pointer-events-none fixed inset-0 z-[400]">
      {hover && rect && (
        <>
          <div
            data-dev-inspector
            className="absolute rounded-[3px] border-2 border-[#ff4fd8] bg-[rgba(255,79,216,0.12)]"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
          <div
            ref={badgeRef}
            data-dev-inspector
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
                {hover.node.kind === "slot" ? "slot" : "el"}
              </span>
              <span className="break-all font-semibold text-[#ffd7f6]">{hover.node.id}</span>
            </div>

            {hover.node.kind === "slot" && (
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
              <span
                className={cn(
                  "shrink-0 rounded-[4px] border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.04em]",
                  copyState === "failed"
                    ? "border-danger text-danger"
                    : copyState === "copied"
                      ? "border-[#ff4fd8] bg-[rgba(255,79,216,0.2)] text-[#ff9ae8]"
                      : "border-[#ff4fd8] text-[#ff9ae8]",
                )}
              >
                {copyState === "copied" ? "Copied!" : copyState === "failed" ? "Copy failed" : "Ctrl+C to copy"}
              </span>
              <span className="break-all text-[#9c93ad]">{selectorFor(hover.node)}</span>
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
