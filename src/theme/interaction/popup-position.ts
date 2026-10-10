export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface Placement {
  top: number;
  left: number;
  maxHeight: number;
  side: Side;
}

const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** Distance from the trigger's edge to the popup's edge that faces it. */
export function anchorGap(side: Side, trigger: Rect, popup: Rect): number {
  if (side === "bottom") return popup.top - (trigger.top + trigger.height);
  if (side === "top") return trigger.top - (popup.top + popup.height);
  if (side === "right") return popup.left - (trigger.left + trigger.width);
  return trigger.left - (popup.left + popup.width);
}

/** Space between the trigger's edge and the matching viewport edge. */
function sideRoom(side: Side, trigger: Rect, viewport: { width: number; height: number }): number {
  if (side === "bottom") return viewport.height - (trigger.top + trigger.height);
  if (side === "top") return trigger.top;
  if (side === "right") return viewport.width - (trigger.left + trigger.width);
  return trigger.left;
}

export function placePopup(input: {
  trigger: Rect;
  popup: { width: number; height: number };
  viewport: { width: number; height: number };
  side: Side;
  align: Align;
  offset: number;
  maxHeight: number;
  margin?: number;
}): Placement {
  const { trigger, popup, viewport, align, offset, maxHeight, margin = 8 } = input;
  const vertical = input.side === "top" || input.side === "bottom";
  const height = Math.min(popup.height, maxHeight);
  const popupSpan = vertical ? height : popup.width;

  let side = input.side;
  const room = sideRoom(side, trigger, viewport);
  if (room < popupSpan + offset + margin) {
    const opposite = sideRoom(OPPOSITE[side], trigger, viewport);
    if (opposite > room) side = OPPOSITE[side];
  }

  const roomOnSide = sideRoom(side, trigger, viewport);
  const maxHeightOut = vertical
    ? Math.max(0, roomOnSide - offset - margin)
    : Math.max(0, viewport.height - 2 * margin);
  // Position with the height the popup will actually get, so a capped popup never slides over its trigger.
  const shown = Math.min(height, maxHeightOut);

  const alongCross = vertical
    ? align === "start"
      ? trigger.left
      : align === "end"
        ? trigger.left + trigger.width - popup.width
        : trigger.left + trigger.width / 2 - popup.width / 2
    : align === "start"
      ? trigger.top
      : align === "end"
        ? trigger.top + trigger.height - shown
        : trigger.top + trigger.height / 2 - shown / 2;

  let top: number;
  let left: number;
  if (side === "bottom") {
    top = trigger.top + trigger.height + offset;
    left = alongCross;
  } else if (side === "top") {
    top = trigger.top - offset - shown;
    left = alongCross;
  } else if (side === "right") {
    left = trigger.left + trigger.width + offset;
    top = alongCross;
  } else {
    left = trigger.left - offset - popup.width;
    top = alongCross;
  }

  left = Math.min(Math.max(left, margin), Math.max(margin, viewport.width - popup.width - margin));
  top = Math.min(Math.max(top, margin), Math.max(margin, viewport.height - shown - margin));

  return { top, left, maxHeight: maxHeightOut, side };
}
