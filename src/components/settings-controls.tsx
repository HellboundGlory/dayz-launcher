import type { CSSProperties, ReactNode } from "react";
import { Gamepad2, AppWindow, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

export type SecId = "game" | "launcher" | "theme";

export const SECS: { id: SecId; icon: typeof Gamepad2; title: string; description: string }[] = [
  { id: "game", icon: Gamepad2, title: "Game", description: "DayZ path, launch params, join behaviour" },
  {
    id: "launcher",
    icon: AppWindow,
    title: "Launcher",
    description: "Tray, startup, refresh cadence, Discord presence",
  },
  { id: "theme", icon: Palette, title: "Theme", description: "Palette, bloom, custom skins" },
];

/** The auto-refresh choices, in seconds. `0` is off. */
export const REFRESH_INTERVALS: { value: number; label: string }[] = [
  { value: 0, label: "Never" },
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 600, label: "Every 10 minutes" },
];

/** The shared text-input / select styling (board `.field input`). */
export const INPUT_CLASS =
  "w-full [border-radius:var(--t-radius-input)] border border-line bg-bg px-2.5 py-2 text-xs text-ink placeholder-muted outline-none transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:border-line-weak focus:border-accent-line";

/** Small secondary button (Detect / Open) sitting next to an input. */
export const BUTTON_CLASS =
  "flex shrink-0 items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-2 [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:text-ink disabled:opacity-50";

/**
 * A labelled control with an optional explanatory line beneath it.
 * `htmlFor`/`hintId` are only used by the themed elements, which need a real
 * `<label>` association — the legacy accordion view never passes them, so its
 * output is unchanged.
 */
export function Field({
  label,
  hint,
  children,
  htmlFor,
  hintId,
  showHint = true,
  dataEl,
  dataState,
  className,
  style,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
  hintId?: string;
  showHint?: boolean;
  dataEl?: string;
  dataState?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const LabelTag = htmlFor ? "label" : "div";
  return (
    <div className={className ?? "field mb-3.5"} data-el={dataEl} data-state={dataState} style={style}>
      <LabelTag
        htmlFor={htmlFor}
        data-part="label"
        className={cn(
          "fb [font-size:var(--t-type-label-size)] font-semibold text-ink",
          htmlFor && "block",
        )}
      >
        {label}
      </LabelTag>
      {hint && showHint && (
        <div id={hintId} data-part="hint" className="fh mt-0.5 [font-size:var(--t-type-caption-size)] leading-[1.4] text-muted">
          {hint}
        </div>
      )}
      <div data-part="control" className="mt-1.5">
        {children}
      </div>
    </div>
  );
}

/**
 * A checkbox with a label and a one-line explanation. `dataEl`/`id`/`hintId`/
 * `disabled` are only used by the themed elements — the legacy accordion view
 * never passes them, so its output is unchanged.
 */
export function CheckboxRow({
  checked,
  onChange,
  label,
  hint,
  showHint = true,
  id,
  hintId,
  disabled,
  dataEl,
  dataState,
  className,
  style,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  showHint?: boolean;
  id?: string;
  hintId?: string;
  disabled?: boolean;
  dataEl?: string;
  dataState?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <label
      data-el={dataEl}
      data-state={dataState}
      className={
        className ??
        (disabled
          ? "chk flex cursor-not-allowed items-start gap-2 py-1.5"
          : "chk flex cursor-pointer items-start gap-2 py-1.5")
      }
      style={style}
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint && showHint ? hintId : undefined}
        data-part="box"
        className={
          disabled
            ? "mt-0.5 size-3.5 shrink-0 accent-accent disabled:cursor-not-allowed"
            : "mt-0.5 size-3.5 shrink-0 accent-accent"
        }
      />
      <span className="min-w-0">
        <span data-part="label" className="cl block [font-size:var(--t-type-body-size)] text-ink">
          {label}
        </span>
        {hint && showHint && (
          <span id={hintId} data-part="hint" className="ch mt-0.5 block [font-size:var(--t-type-caption-size)] leading-[1.4] text-muted">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
