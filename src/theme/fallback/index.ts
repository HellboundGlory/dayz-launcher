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
