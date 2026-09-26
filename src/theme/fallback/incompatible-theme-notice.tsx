import { useThemeStore } from "../theme-store";

/** SPEC §16.3: shown once, launcher-owned, while Neutral is active because a v1 theme was switched off. */
export function IncompatibleThemeNotice() {
  const replaced = useThemeStore((s) => s.incompatibleSwitch);
  const dismiss = useThemeStore((s) => s.dismissIncompatibleSwitch);

  if (replaced === null) {
    return null;
  }

  return (
    <div
      data-part="incompatible-theme-notice"
      role="status"
      className="flex items-center justify-between gap-[var(--t-space-inlineGapWide)] border-b border-warn bg-warn-soft px-[var(--t-space-rowX)] py-[var(--t-space-controlY)] text-ink"
    >
      <div className="flex items-center gap-[var(--t-space-inlineGapWide)]">
        <span
          data-part="label"
          className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-warn"
        >
          THEME
        </span>
        <span data-part="message" className="[font-size:var(--t-type-body-size)]">
          {replaced.name} uses an older theme format and was switched off. You can delete it
          from Settings → Themes.
        </span>
      </div>
      <button
        type="button"
        data-part="dismiss"
        onClick={dismiss}
        className="rounded px-2 py-1 text-xs font-semibold uppercase hover:bg-surface2"
      >
        Dismiss
      </button>
    </div>
  );
}
