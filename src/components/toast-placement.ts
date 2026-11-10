type Box = { left: number; top: number; right: number; bottom: number };

const MIN_TOP = 48;
const GAP = 8;
// Only toolbar controls near the top push the stack down, never ones further into the page.
const BAND = 160;

/** Top edge for the toast stack: below every toolbar control it would otherwise cover. */
export function toastTop(controls: Box[], column: { left: number; right: number }): number {
  let top = MIN_TOP;
  for (const c of controls) {
    if (c.top >= BAND || c.right <= column.left || c.left >= column.right) continue;
    top = Math.max(top, Math.ceil(c.bottom) + GAP);
  }
  return top;
}

const CONTROLS = "button, input, select, [role='button'], [role='combobox']";

/** Boxes of the visible controls outside lists and the toast stack itself. */
export function toolbarControls(host: HTMLElement): Box[] {
  const boxes: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (host.contains(el) || el.closest("[data-el^='list.'], [role='dialog']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) boxes.push(r);
  }
  return boxes;
}
