import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/** Read-only slot inspector: outlines whatever slot/element the pointer is over
 * and reports the registry's children for it. Mounted only while Dev Mode is
 * on, so the listener and the overlay exist for exactly that long. */
export function DevModeInspector() {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // Keyed on the rounded rect too, so a layout shift under a stationary pointer
  // re-positions the outline while an unchanged hover skips the re-render.
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Its own badge and outline, so reaching for "Copy selector" doesn't
      // blank the readout it is about to copy.
      if (target.closest("[data-dev-inspector]")) return;
      const node = findTetraNode(target);
      const rect = node?.element.getBoundingClientRect() ?? null;
      const key =
        node === null || rect === null
          ? ""
          : `${node.kind}:${node.id}:${Math.round(rect.top)},${Math.round(rect.left)},${Math.round(rect.width)},${Math.round(rect.height)}`;
      if (key === lastKey.current) return;
      lastKey.current = key;
      setHover(node === null || rect === null ? null : { node, rect });
      setCopyState("idle");
    }
    function onOut(e: MouseEvent) {
      if (e.relatedTarget !== null) return;
      lastKey.current = null;
      setHover(null);
      setCopyState("idle");
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);

  async function copySelector(node: TetraNode) {
    try {
      await navigator.clipboard.writeText(selectorFor(node));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const slot =
    hover !== null && hover.node.kind === "slot"
      ? SLOTS.find((s) => s.id === hover.node.id)
      : undefined;
  const required = slot?.children.filter((c) => c.required) ?? [];
  const optional = slot?.children.filter((c) => !c.required) ?? [];
  const { rect } = hover ?? {};

  // The badge is measured rather than guessed: a full-height slot (the sidebar)
  // has no room below it, and a tall element's badge must not land off-screen.
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const [badge, setBadge] = useState({ w: BADGE_MAX_W, h: 0 });
  useLayoutEffect(() => {
    const el = badgeRef.current;
    if (el === null) return;
    setBadge({ w: el.offsetWidth, h: el.offsetHeight });
  }, [hover, copyState]);

  const margin = 8;
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
            className="pointer-events-auto absolute overflow-auto rounded-[6px] border border-[#ff4fd8] bg-[rgba(12,10,16,0.95)] px-2.5 py-2 font-mono-data text-[10px] leading-[1.5] text-[#e9e6f2] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
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
              <button
                type="button"
                onClick={() => void copySelector(hover.node)}
                className="rounded-[4px] border border-[#ff4fd8] px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.04em] text-[#ff9ae8] transition-colors hover:bg-[rgba(255,79,216,0.2)]"
              >
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy selector"}
              </button>
              <span className="break-all text-[#9c93ad]">{selectorFor(hover.node)}</span>
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
