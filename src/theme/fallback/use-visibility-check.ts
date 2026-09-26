// SPEC §15 / ADR-0011: one batched read-only pass over the current screen's
// required elements, on layout events only — never on data updates.
import { useEffect, useRef } from "react";
import { useDevStore } from "../dev/dev-store";
import { REGISTRY } from "../registry";
import type { LayoutFile, PopupLayoutFile } from "../renderer/types";
import { getThemeOwnedLayout, useThemeStore } from "../theme-store";
import { isElementInLayout } from "./auto-placement";
import { isFileFallenBack, markFileFallback } from "./store";
import { MISSING_ELEMENT_REASON, runVisibilityCheck } from "./visibility";

/** Perf entry the harness reads (§24). */
export const VISIBILITY_CHECK_MEASURE = "tetra:visibility-check";
const START_MARK = `${VISIBILITY_CHECK_MEASURE}:start`;

/** §15: window resize is debounced. */
export const RESIZE_DEBOUNCE_MS = 150;

/** Disclosure and tab changes re-run the check: accordion headers, popup
 * triggers, region collapse. `aria-selected` only counts on real tabs — list
 * rows toggle it too, and selection is not a layout change. */
const TRIGGER_SELECTOR = '[aria-expanded], [role="tab"]';

const SHELL_FILE = "layout/shell.json";

export interface VisibilityCheckEnv {
  /** Current view; anything but `mods` renders the browser view. */
  activeView: string;
  settingsOpen: boolean;
  /** `view` Settings replaces the view it would otherwise sit over. */
  settingsPresentation?: "overlay" | "panel" | "view";
  /** Open themeable modal ids, e.g. `serverInfo`. */
  openModals?: readonly string[];
}

export interface OpenPopup {
  id: string;
  /** Placement mode of the open popup's theme-owned file, when it has one. */
  mode: "anchored" | "region" | "inline" | undefined;
}

export interface ActiveContexts {
  contexts: string[];
  openModals: string[];
  openPopups: OpenPopup[];
}

/** One required context per `list:<id>/row` value, with the list host it needs. */
const LIST_ROW_CONTEXTS = (() => {
  const seen = new Map<string, string>();
  for (const def of Object.values(REGISTRY.elements)) {
    for (const context of def.required) {
      const match = /^list:(.+)\/row$/.exec(context);
      if (match && !seen.has(context)) seen.set(context, `list.${match[1]}`);
    }
  }
  return Array.from(seen, ([context, hostElement]) => ({ context, hostElement }));
})();

/** The contexts live right now, from App state plus what the DOM actually renders. */
export function resolveActiveContexts(
  env: VisibilityCheckEnv,
  root: Document | HTMLElement,
): ActiveContexts {
  const contexts = new Set<string>(["views", "views+settings"]);
  const settingsInView = env.settingsOpen && (env.settingsPresentation ?? "overlay") === "view";

  if (!settingsInView) {
    contexts.add(env.activeView === "mods" ? "view:mods" : "view:browser");
    for (const { context, hostElement } of LIST_ROW_CONTEXTS) {
      const host = root.querySelector<HTMLElement>(`[data-el="${hostElement}"]`);
      // An empty list renders no rows, so its template has nothing to measure.
      if (host?.querySelector('[role="row"], [data-row]')) contexts.add(context);
    }
  }

  if (env.settingsOpen) contexts.add("settings");

  // `withJoin` is required wherever `server.join` is, so it follows Join's own contexts.
  const joinContexts = REGISTRY.elements["server.join"]?.required ?? [];
  if (joinContexts.some((context) => contexts.has(context))) contexts.add("withJoin");

  const openModals = (env.openModals ?? []).filter((id) => REGISTRY.modals[id] !== undefined);
  for (const id of openModals) contexts.add(`modal:${id}`);
  if (openModals.length > 0 || root.querySelector("[data-modal-host]")) contexts.add("modal");

  const openPopups: OpenPopup[] = [];
  for (const [id, def] of Object.entries(REGISTRY.popups)) {
    const trigger = root.querySelector(
      `[data-el="${def.openedBy}"][aria-expanded="true"], [data-el="${def.openedBy}"] [aria-expanded="true"]`,
    );
    if (!trigger) continue;
    const layout = getThemeOwnedLayout(`layout/popups/${id}.json`) as PopupLayoutFile | undefined;
    const mode = layout?.placement?.mode;
    openPopups.push({ id, mode });
    contexts.add(`popup:${id}`);
    if (mode === "region") contexts.add("popup:region");
    else if (mode === "inline") contexts.add("popup:inline");
  }

  return { contexts: [...contexts], openModals, openPopups };
}

/** Element id -> the active contexts that require it (REGISTRY §6.1). */
export function resolveRequiredElements(
  contexts: readonly string[],
): Map<string, string[]> {
  const active = new Set(contexts);
  const required = new Map<string, string[]>();
  for (const [id, def] of Object.entries(REGISTRY.elements)) {
    const matched = def.required.filter((context) => active.has(context));
    if (matched.length > 0) required.set(id, matched);
  }
  return required;
}

/** The layout files a context is attributed to (§5.1's path convention). */
function layoutPathsForContext(context: string, active: ActiveContexts): string[] {
  if (context === "views" || context === "views+settings") return [SHELL_FILE];
  if (context === "settings") return ["layout/settings.json"];
  if (context.startsWith("view:")) return [`layout/views/${context.slice("view:".length)}.json`];
  if (context.startsWith("list:")) {
    const match = /^list:(.+)\/row$/.exec(context);
    return match ? [`layout/lists/${match[1]}.json`] : [];
  }
  if (context === "modal") return active.openModals.map((id) => `layout/modals/${id}.json`);
  if (context.startsWith("modal:")) return [`layout/modals/${context.slice("modal:".length)}.json`];
  if (context.startsWith("popup:")) {
    const id = context.slice("popup:".length);
    if (id === "region" || id === "inline") {
      return active.openPopups
        .filter((popup) => popup.mode === id)
        .map((popup) => `layout/popups/${popup.id}.json`);
    }
    return [`layout/popups/${id}.json`];
  }
  if (context === "withJoin") {
    // `withJoin` shares whatever file is required to place `server.join`.
    const joinContexts = (REGISTRY.elements["server.join"]?.required ?? []).filter((c) =>
      active.contexts.includes(c),
    );
    return Array.from(new Set(joinContexts.flatMap((c) => layoutPathsForContext(c, active))));
  }
  return [];
}

export interface ElementAttribution {
  /** The theme-owned file whose screen is broken. */
  file: string;
  /** True when that file actually places the element; false when it omits it. */
  placed: boolean;
}

/** The screen to fall back for a failed element, or `undefined` when Neutral owns it. */
export function attributeElement(
  element: string,
  requiredContexts: readonly string[],
  active: ActiveContexts,
): ElementAttribution | undefined {
  const candidates = Array.from(
    new Set(requiredContexts.flatMap((context) => layoutPathsForContext(context, active))),
  );

  // A file that actually places the element is the screen to fall back.
  for (const path of candidates) {
    const layout = getThemeOwnedLayout(path);
    if (layout && isElementInLayout(layout, element)) return { file: path, placed: true };
  }
  // Missing entirely: the theme-owned file that must have placed it.
  for (const path of candidates) {
    if (getThemeOwnedLayout(path)) return { file: path, placed: false };
  }
  // The context's own file isn't the theme's — blame whichever theme file places it.
  const { activeId, themeFiles } = useThemeStore.getState();
  for (const [path, layout] of Object.entries(themeFiles[activeId]?.layouts ?? {})) {
    if (isFileFallenBack(path)) continue;
    if (isElementInLayout(layout as LayoutFile, element)) return { file: path, placed: true };
  }
  return undefined;
}

export interface VisibilityCheckRun {
  env: VisibilityCheckEnv;
  themeId: string;
  root?: Document | HTMLElement;
}

/** One batched pass: measure, then fall back the screens that failed. */
export function applyVisibilityCheck({
  env,
  themeId,
  root = typeof document !== "undefined" ? document : undefined,
}: VisibilityCheckRun): void {
  if (!root) return;
  // Without a theme-owned shell the launcher renders its legacy components,
  // which carry none of the themed host attributes.
  if (!getThemeOwnedLayout(SHELL_FILE)) return;

  const active = resolveActiveContexts(env, root);
  const required = resolveRequiredElements(active.contexts);

  const perf = typeof performance !== "undefined" ? performance : undefined;
  perf?.mark?.(START_MARK);
  const result =
    required.size > 0
      ? runVisibilityCheck({ root, requiredElements: [...required.keys()] })
      : { passed: true, failures: [] };
  perf?.measure?.(VISIBILITY_CHECK_MEASURE, START_MARK);
  perf?.clearMarks?.(START_MARK);

  if (result.passed) return;

  const reasonsByFile = new Map<string, string[]>();
  for (const failure of result.failures) {
    const attribution = attributeElement(
      failure.element,
      required.get(failure.element) ?? [],
      active,
    );
    if (!attribution) continue;
    // The launcher mounts some required elements only in some states — the update
    // modal shows install *or* view-release. A theme that placed the element did
    // its part; its absence is launcher state, not a missing requirement.
    if (attribution.placed && failure.reason === MISSING_ELEMENT_REASON) continue;

    const reasons = reasonsByFile.get(attribution.file) ?? [];
    reasons.push(`${failure.element}: ${failure.reason}`);
    reasonsByFile.set(attribution.file, reasons);
  }
  for (const [file, reasons] of reasonsByFile) markFileFallback(themeId, file, reasons);
}

export interface VisibilityCheckTargets {
  /** Latest App state; read at run time so a stale render can't matter. */
  getEnv: () => VisibilityCheckEnv;
  getThemeId: () => string;
  root?: Document | HTMLElement;
  /** Test seam: called once per completed pass. */
  onRun?: () => void;
}

/**
 * Wires the §15 triggers: an initial pass, a debounced resize, and
 * aria-expanded/aria-selected changes on tabs, accordion headers and popup
 * triggers. Passes are scheduled after paint — fonts, then two frames.
 * Returns the teardown.
 */
export function startVisibilityChecks({
  getEnv,
  getThemeId,
  root = typeof document !== "undefined" ? document : undefined,
  onRun,
}: VisibilityCheckTargets): () => void {
  if (!root) return () => {};

  let timer: number | undefined;
  let frame1 = 0;
  let frame2 = 0;
  let generation = 0;
  let disposed = false;

  const run = () => {
    if (disposed) return;
    onRun?.();
    applyVisibilityCheck({ env: getEnv(), themeId: getThemeId(), root });
  };

  const schedule = (delay = 0) => {
    if (disposed) return;
    generation += 1;
    const current = generation;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      const fontsReady =
        typeof document !== "undefined" && document.fonts
          ? document.fonts.ready
          : Promise.resolve();
      void fontsReady.then(() => {
        if (disposed || current !== generation) return;
        frame1 = requestAnimationFrame(() => {
          frame2 = requestAnimationFrame(() => {
            if (disposed || current !== generation) return;
            run();
          });
        });
      });
    }, delay);
  };

  schedule(0);

  const onResize = () => schedule(RESIZE_DEBOUNCE_MS);
  window.addEventListener("resize", onResize);

  const observer =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            const target = mutation.target as Element | null;
            if (target && typeof target.matches === "function" && target.matches(TRIGGER_SELECTOR)) {
              schedule();
              return;
            }
          }
        })
      : undefined;
  observer?.observe(root === document ? document.body : (root as Node), {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-selected", "aria-expanded"],
  });

  return () => {
    disposed = true;
    generation += 1;
    if (timer !== undefined) window.clearTimeout(timer);
    cancelAnimationFrame(frame1);
    cancelAnimationFrame(frame2);
    window.removeEventListener("resize", onResize);
    observer?.disconnect();
  };
}

/**
 * Mounts the §15 check once in `App`. The effect re-runs — and so re-checks —
 * on theme activation and hot reload, variant switch, view change, and
 * modal/Settings open; resize and tab/accordion/popup changes are handled by
 * the scheduler itself.
 */
export function useVisibilityCheck(env: VisibilityCheckEnv): void {
  const activeId = useThemeStore((s) => s.activeId);
  const themeFiles = useThemeStore((s) => s.themeFiles);
  const variantWidth = useDevStore((s) => s.variantWidth);
  const envRef = useRef(env);
  envRef.current = env;
  const modalKey = (env.openModals ?? []).join(",");

  useEffect(() => {
    if (activeId === "neutral" || typeof document === "undefined") return;
    return startVisibilityChecks({
      getEnv: () => envRef.current,
      getThemeId: () => activeId,
    });
  }, [
    activeId,
    themeFiles,
    variantWidth,
    env.activeView,
    env.settingsOpen,
    env.settingsPresentation,
    modalKey,
  ]);
}
