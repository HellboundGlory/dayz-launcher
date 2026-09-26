export interface ElementVisibilityResult {
  visible: boolean;
  reason?: string;
}

/** A required element with no node in the current composition. */
export const MISSING_ELEMENT_REASON = "Element not found in document";

export interface VisibilityCheckFailure {
  element: string;
  reason: string;
}

export interface VisibilityCheckResult {
  passed: boolean;
  failures: VisibilityCheckFailure[];
}

export interface VisibilityCheckOptions {
  root?: HTMLElement | Document;
  windowBounds?: { width: number; height: number };
  requiredElements?: string[];
  isModalOpen?: boolean;
  isSettingsOpen?: boolean;
  settingsPresentation?: "overlay" | "panel" | "view";
}

/** Every host an open popup renders into: `popup-host.tsx` adds `data-popup-host`,
 * the launcher's own popup bodies carry `data-part="popup"`. */
const OPEN_POPUP_SELECTOR = '[data-popup-host], [data-part="popup"]';
// Dev Mode's own floating panels; a theme can't keep clear of them.
const DEV_TOOLING_SELECTOR = "[data-dev-panel], [data-dev-inspector]";

interface CheckedStyle {
  display?: string;
  visibility?: string;
  opacity?: string;
  overflowX?: string;
  overflowY?: string;
}

function computedStyle(element: HTMLElement): CheckedStyle {
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    return window.getComputedStyle(element) as unknown as CheckedStyle;
  }
  return (element.style ?? {}) as CheckedStyle;
}

/** The nearest ancestor the element is scrolled out of, when that ancestor scrolls on the axis. */
function scrolledOutPane(
  element: HTMLElement,
  rect: { top: number; bottom: number; left: number; right: number },
): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = computedStyle(node);
    const scrollsX =
      (style.overflowX === "auto" || style.overflowX === "scroll") &&
      node.scrollWidth > node.clientWidth;
    const scrollsY =
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight;
    const paneRect = node.getBoundingClientRect();
    const outX = rect.left < paneRect.left || rect.right > paneRect.right;
    const outY = rect.top < paneRect.top || rect.bottom > paneRect.bottom;
    if ((scrollsX && outX) || (scrollsY && outY)) return node;
  }
  return null;
}

/** Whether the hit test at a centre point lands on something else. */
function centreOccluded(container: HTMLElement, cx: number, cy: number): boolean {
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") {
    return false;
  }
  const hit = document.elementFromPoint(cx, cy);
  if (!hit || hit === container || container.contains(hit)) return false;
  if (typeof hit.closest === "function" && hit.closest(DEV_TOOLING_SELECTOR)) return false;

  // An open popup paints over the page, so the page beneath it isn't occluded.
  const popup = typeof hit.closest === "function" ? hit.closest(OPEN_POPUP_SELECTOR) : null;
  return !popup || popup.contains(container);
}

export function checkElementVisibility(
  element: HTMLElement,
  windowBounds?: { width: number; height: number },
): ElementVisibilityResult {
  // 1. Style checks
  const style = computedStyle(element);

  if (style.display === "none") {
    return { visible: false, reason: "display is none" };
  }
  if (style.visibility === "hidden" || style.visibility === "collapse") {
    return { visible: false, reason: `visibility is ${style.visibility}` };
  }
  if (style.opacity !== undefined && style.opacity !== "" && parseFloat(style.opacity) <= 0) {
    return { visible: false, reason: "opacity is 0" };
  }

  // 2. Bounding dimensions check
  const rect =
    typeof element.getBoundingClientRect === "function"
      ? element.getBoundingClientRect()
      : { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 };

  if (rect.width <= 0 || rect.height <= 0) {
    return { visible: false, reason: "dimensions are zero or negative" };
  }

  // 3. Geometry. An element scrolled out of its pane is reachable by scrolling,
  // so a pane that passes stands in for it (§15 judges what the user can reach).
  const geometryFailure = (reason: string): ElementVisibilityResult => {
    const pane = scrolledOutPane(element, rect);
    return pane ? checkElementVisibility(pane, windowBounds) : { visible: false, reason };
  };

  // 4. Inside window bounds
  const winWidth = windowBounds?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const winHeight = windowBounds?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768);

  const inBounds =
    rect.bottom > 0 &&
    rect.top < winHeight &&
    rect.right > 0 &&
    rect.left < winWidth;

  if (!inBounds) {
    return geometryFailure("outside window bounds");
  }

  // 5. Center point occlusion
  if (centreOccluded(element, rect.left + rect.width / 2, rect.top + rect.height / 2)) {
    return geometryFailure("center point occluded by another element");
  }

  // 6. Interactive focusability. A `disabled` control is launcher state, not a
  // layout fault — ELEMENTS.md has required actions going `disabled` while busy
  // or playing — so only a theme-removed tab stop fails here.
  const tag = element.tagName.toLowerCase();
  const isInteractiveTag = ["button", "a", "input", "select", "textarea"].includes(tag);
  const hasTabIndex = element.hasAttribute("tabindex") && element.tabIndex >= 0;

  if (isInteractiveTag || hasTabIndex) {
    const isTabDisabled = element.tabIndex === -1 || element.getAttribute("tabindex") === "-1";
    if (isTabDisabled) {
      return { visible: false, reason: "interactive element has tabIndex === -1" };
    }
  }

  return { visible: true };
}

/** The row a list element lives in, when that row is the selected one. */
function rowIsSelected(element: HTMLElement): boolean {
  const row = element.closest('[role="row"], [data-row]');
  if (!row) return false;
  const state = row.getAttribute("data-state") ?? "";
  return state.includes("selected") || row.getAttribute("aria-selected") === "true";
}

/** Whether any `server.join` inside the selection panel renders visibly. */
function selectionPanelJoinVisible(
  root: HTMLElement | Document,
  windowBounds?: { width: number; height: number },
): boolean {
  const panels = root.querySelectorAll<HTMLElement>('[data-context="selection"]');
  for (const panel of Array.from(panels)) {
    const joins = panel.querySelectorAll<HTMLElement>('[data-el="server.join"]');
    for (const join of Array.from(joins)) {
      if (checkElementVisibility(join, windowBounds).visible) return true;
    }
  }
  return false;
}

export function runVisibilityCheck(options: VisibilityCheckOptions = {}): VisibilityCheckResult {
  const doc = typeof document !== "undefined" ? document : null;
  const root = options.root ?? doc;
  if (!root) {
    return { passed: true, failures: [] };
  }

  const failures: VisibilityCheckFailure[] = [];

  const modalEl = root.querySelector?.('[data-modal-host], [role="dialog"]');
  const isModalOpen = options.isModalOpen ?? Boolean(modalEl);

  const settingsEl = root.querySelector?.(
    '[data-settings-host][data-presentation="overlay"], [data-settings-host][data-presentation="panel"]',
  );
  const isSettingsOverlay =
    options.isSettingsOpen &&
    (options.settingsPresentation === "overlay" || options.settingsPresentation === "panel")
      ? true
      : Boolean(settingsEl);

  function isSkipped(el: HTMLElement): boolean {
    const elId = el.getAttribute("data-el") || "";

    // Skip unshown notices
    if (elId.startsWith("notice.") || elId === "server.actionNotice") {
      const isDismissed = el.getAttribute("data-state")?.includes("dismissed");
      const isHidden = el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true";
      const hasNoText = (el.innerText?.trim() ?? el.textContent?.trim() ?? "") === "";
      if (isDismissed || isHidden || hasNoText) {
        return true;
      }
    }

    // Skip unselected / unfocused list rows
    const row = el.closest('[role="row"], [data-row]');
    if (row) {
      const state = row.getAttribute("data-state") || "";
      const isSelected = state.includes("selected") || row.getAttribute("aria-selected") === "true";
      const isFocused =
        state.includes("focused") ||
        row.classList.contains("focused") ||
        Boolean(doc && (doc.activeElement === row || row.contains(doc.activeElement)));
      if (!isSelected && !isFocused) {
        return true;
      }

      // The selected row scrolled out of view has nothing measurable; failing it
      // would fall the list back on a resize.
      const rowRect =
        typeof row.getBoundingClientRect === "function" ? row.getBoundingClientRect() : null;
      const viewportHeight =
        options.windowBounds?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768);
      if (rowRect && (rowRect.bottom <= 0 || rowRect.top >= viewportHeight)) {
        return true;
      }
    }

    // Skip closed accordion sections, inactive tab panels, collapsed subtrees
    const section = el.closest("[data-section]");
    if (section && section.getAttribute("data-state") === "closed") {
      return true;
    }
    const hiddenRegion = el.closest('[role="region"][hidden]');
    if (hiddenRegion) {
      return true;
    }
    const tabpanel = el.closest('[role="tabpanel"]');
    if (tabpanel && (tabpanel.hasAttribute("hidden") || tabpanel.getAttribute("aria-hidden") === "true")) {
      return true;
    }
    const collapsed = el.closest('[data-collapsed="true"]');
    if (collapsed) {
      return true;
    }

    // While a modal is open: only check modal elements
    if (isModalOpen) {
      const inModal = el.closest('[data-modal-host], [role="dialog"]');
      if (!inModal) {
        return true;
      }
    }

    // While settings is overlay/panel: skip underlying view, keep window controls & drag region
    if (isSettingsOverlay) {
      const inSettings = el.closest("[data-settings-host]");
      if (!inSettings) {
        const isWindowChrome =
          elId === "app.dragRegion" ||
          elId === "app.minimize" ||
          elId === "app.maximize" ||
          elId === "app.close" ||
          Boolean(el.closest('[data-surface="surface.windowControls"]'));
        if (!isWindowChrome) {
          return true;
        }
      }
    }

    return false;
  }

  if (options.requiredElements && options.requiredElements.length > 0) {
    for (const reqId of options.requiredElements) {
      const matches = Array.from(root.querySelectorAll<HTMLElement>(`[data-el="${reqId}"]`));

      // Notices that aren't showing are skipped if missing or hidden. The action
      // notice is in this class: it renders only while it has something to report.
      if (reqId.startsWith("notice.") || reqId === "server.actionNotice") {
        if (matches.length === 0) continue;
        const showing = matches.some((el) => !isSkipped(el));
        if (!showing) continue;
      }

      // If modal is open, elements outside modal belong to underlying page and are skipped
      if (isModalOpen) {
        const inModalMatches = matches.filter((el) => el.closest('[data-modal-host], [role="dialog"]'));
        if (inModalMatches.length === 0) {
          continue;
        }
      }

      // If settings overlay is open, elements outside settings (except window chrome) are skipped
      if (isSettingsOverlay) {
        const isWindowChrome =
          reqId === "app.dragRegion" ||
          reqId === "app.minimize" ||
          reqId === "app.maximize" ||
          reqId === "app.close";
        if (!isWindowChrome) {
          const inSettingsMatches = matches.filter((el) => el.closest("[data-settings-host]"));
          if (inSettingsMatches.length === 0) {
            continue;
          }
        }
      }

      if (matches.length === 0) {
        failures.push({ element: reqId, reason: MISSING_ELEMENT_REASON });
        continue;
      }

      for (const el of matches) {
        if (isSkipped(el)) continue;
        const res = checkElementVisibility(el, options.windowBounds);
        if (!res.visible) {
          // Joining the selected server always works (§15), so the selection panel's
          // own Join covers the selected row's. A focused-but-unselected row still
          // needs its own.
          if (
            reqId === "server.join" &&
            rowIsSelected(el) &&
            selectionPanelJoinVisible(root, options.windowBounds)
          ) {
            continue;
          }
          failures.push({ element: reqId, reason: res.reason ?? "Visibility check failed" });
        }
      }
    }
  } else {
    // Batched check of all [data-el] elements
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-el]"));
    for (const el of elements) {
      if (isSkipped(el)) continue;
      const res = checkElementVisibility(el, options.windowBounds);
      if (!res.visible) {
        const elId = el.getAttribute("data-el") || "unknown";
        failures.push({ element: elId, reason: res.reason ?? "Visibility check failed" });
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
