import { useFallbackStore, isFallbackNoticeDismissed } from "./store";

export interface FallbackNoticeProps {
  themeId?: string;
  launcherVersion?: string;
  className?: string;
  onDismiss?: () => void;
}

export function FallbackNotice({
  themeId = "current",
  launcherVersion = "2.6.0",
  className,
  onDismiss,
}: FallbackNoticeProps) {
  const storeFiles = useFallbackStore((s) => s.fallbackFiles);
  const fallbackFiles =
    Object.keys(storeFiles).length > 0 ? storeFiles : useFallbackStore.getState().fallbackFiles;

  const storeDismissed = useFallbackStore((s) => s.fallbackNoticeDismissed);
  const dismissedMap =
    Object.keys(storeDismissed).length > 0 ? storeDismissed : useFallbackStore.getState().fallbackNoticeDismissed;

  const dismiss = useFallbackStore((s) => s.dismissFallbackNotice);

  const hasFallback = Object.values(fallbackFiles).some(Boolean);
  const key = `${themeId}:${launcherVersion}`;
  const isDismissed = dismissedMap[key] ?? isFallbackNoticeDismissed(themeId, launcherVersion);

  if (!hasFallback || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    dismiss(themeId, launcherVersion);
    onDismiss?.();
  };

  return (
    <div
      data-part="fallback-notice"
      role="status"
      className={
        className ??
        "flex items-center justify-between gap-[var(--t-space-inlineGapWide)] border-b border-warn bg-warn-soft px-[var(--t-space-rowX)] py-[var(--t-space-controlY)] text-ink"
      }
    >
      <div className="flex items-center gap-[var(--t-space-inlineGapWide)]">
        <span
          data-part="label"
          className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-warn"
        >
          FALLBACK
        </span>
        <span data-part="message" className="[font-size:var(--t-type-body-size)]">
          One or more screens could not be displayed with the current theme layout and fell back to default
        </span>
      </div>
      <button
        type="button"
        data-part="dismiss"
        onClick={handleDismiss}
        className="rounded px-2 py-1 text-xs font-semibold uppercase hover:bg-surface2"
      >
        Dismiss
      </button>
    </div>
  );
}
