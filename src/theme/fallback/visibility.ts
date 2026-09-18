export interface ElementVisibilityResult {
  visible: boolean;
  reason?: string;
}

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

export function checkElementVisibility(
  element: HTMLElement,
  windowBounds?: { width: number; height: number },
): ElementVisibilityResult {
  // 1. Style checks
  const style =
    typeof window !== "undefined" && typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(element)
      : (element.style ?? {});

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

  // 3. Inside window bounds
  const winWidth = windowBounds?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const winHeight = windowBounds?.height ?? (typeof window !== "undefined" ? window.innerHeight : 768);

  const inBounds =
    rect.bottom > 0 &&
    rect.top < winHeight &&
    rect.right > 0 &&
    rect.left < winWidth;

  if (!inBounds) {
    return { visible: false, reason: "outside window bounds" };
  }

  // 4. Center point occlusion
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  if (typeof document !== "undefined" && typeof document.elementFromPoint === "function") {
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== element && !element.contains(hit)) {
      return { visible: false, reason: "center point occluded by another element" };
    }
  }

  // 5. Interactive focusability
  const tag = element.tagName.toLowerCase();
  const isInteractiveTag = ["button", "a", "input", "select", "textarea"].includes(tag);
  const hasTabIndex = element.hasAttribute("tabindex") && element.tabIndex >= 0;

  if (isInteractiveTag || hasTabIndex) {
    const isDisabled =
      (element as { disabled?: boolean }).disabled === true ||
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true";

    if (isDisabled) {
      return { visible: false, reason: "interactive element is disabled" };
    }

    const isTabDisabled = element.tabIndex === -1 || element.getAttribute("tabindex") === "-1";
    if (isTabDisabled) {
      return { visible: false, reason: "interactive element has tabIndex === -1" };
    }
  }

  return { visible: true };
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

      // Notices that aren't showing are skipped if missing or hidden
      if (reqId.startsWith("notice.")) {
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
        failures.push({ element: reqId, reason: "Element not found in document" });
        continue;
      }

      for (const el of matches) {
        if (isSkipped(el)) continue;
        const res = checkElementVisibility(el, options.windowBounds);
        if (!res.visible) {
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
