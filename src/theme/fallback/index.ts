export {
  applyAutoPlacement,
  isElementInLayout,
  isElementInNode,
  getMissingRequiredElements,
  resolveFallbackPlacement,
  type AutoPlacedEntry,
  type AutoPlacementResult,
} from "./auto-placement";

export {
  checkElementVisibility,
  runVisibilityCheck,
  type ElementVisibilityResult,
  type VisibilityCheckFailure,
  type VisibilityCheckResult,
  type VisibilityCheckOptions,
} from "./visibility";

export {
  useVisibilityCheck,
  startVisibilityChecks,
  applyVisibilityCheck,
  resolveActiveContexts,
  resolveRequiredElements,
  attributeElement,
  VISIBILITY_CHECK_MEASURE,
  RESIZE_DEBOUNCE_MS,
  type ActiveContexts,
  type ElementAttribution,
  type OpenPopup,
  type VisibilityCheckEnv,
  type VisibilityCheckRun,
  type VisibilityCheckTargets,
} from "./use-visibility-check";

export {
  useFallbackStore,
  markFileFallback,
  isFileFallenBack,
  clearFallbacks,
  isFallbackNoticeDismissed,
  dismissFallbackNotice,
  clearFallbackMemory,
  type FallbackStore,
} from "./store";

export { FallbackNotice, type FallbackNoticeProps } from "./fallback-notice";
