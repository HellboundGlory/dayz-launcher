import { useState, useEffect, type CSSProperties } from "react";
import { Minus, Square, X, ChevronsLeft, ChevronsRight, Sun, Moon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import tetraLogo from "@/assets/tetra-logo.png";
import { useThemeStore } from "@/theme/theme-store";
import { useSettingsStore } from "@/stores/settings-store";
import { setUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "@/lib/tauri";
import { useElementContext } from "./context";
import { OptionIcon } from "./option-icon";

interface OptionsProps {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}

export function AppMinimize({ options, className, style }: OptionsProps) {
  const minimize = () => {
    getCurrentWindow().minimize().catch(() => {});
  };
  return (
    <button
      type="button"
      data-el="app.minimize"
      onClick={minimize}
      title="Minimize"
      aria-label="Minimize"
      className={className}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={Minus} className="size-[var(--t-space-iconMedium)]" />
      </span>
    </button>
  );
}

export function AppMaximize({ options, className, style }: OptionsProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    getCurrentWindow()
      .onResized(() => {
        getCurrentWindow().isMaximized().then(setMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  const toggle = () => {
    getCurrentWindow().toggleMaximize().catch(() => {});
  };

  return (
    <button
      type="button"
      data-el="app.maximize"
      data-state={maximized ? "maximized" : undefined}
      onClick={toggle}
      title="Maximize"
      aria-label="Maximize"
      className={className}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={Square} className="size-[var(--t-space-iconSmall)]" />
      </span>
    </button>
  );
}

export function AppClose({ options, className, style }: OptionsProps) {
  const close = () => {
    getCurrentWindow().close().catch(() => {});
  };
  return (
    <button
      type="button"
      data-el="app.close"
      onClick={close}
      title="Close"
      aria-label="Close"
      className={className}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={X} className="size-[var(--t-space-iconMedium)]" />
      </span>
    </button>
  );
}

export function AppDragRegion({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      data-el="app.dragRegion"
      data-tauri-drag-region
      className={className ?? "h-full w-full select-none"}
      style={style}
    />
  );
}

export function AppLogo({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const showWordmark = options?.wordmark !== false;
  return (
    <div data-el="app.logo" className={className ?? "flex items-center gap-[var(--t-space-inlineGapWide)]"} style={style}>
      <img
        data-part="image"
        src={tetraLogo}
        alt=""
        draggable={false}
        className="size-[var(--t-space-iconLarge)] shrink-0 [border-radius:var(--t-radius-controlSmall)] [box-shadow:var(--t-glow-rest)]"
      />
      {showWordmark && (
        <span
          data-part="wordmark"
          className="truncate [font-size:var(--t-type-brand-size)] [font-weight:var(--t-type-button-weight)] [letter-spacing:var(--t-type-brand-tracking)] text-accent"
        >
          TETRA
        </span>
      )}
    </div>
  );
}

export function AppCollapseToggle({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const { isCollapsed, toggleCollapsed } = useElementContext();
  const regionId = typeof options?.region === "string" ? options.region : "sidebar";
  const label = typeof options?.label === "string" ? options.label : "sidebar";
  const collapsed = isCollapsed(regionId);

  return (
    <button
      type="button"
      data-el="app.collapseToggle"
      data-state={collapsed ? "collapsed" : undefined}
      aria-expanded={!collapsed}
      aria-controls={regionId}
      aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      onClick={() => toggleCollapsed(regionId)}
      className={className}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon
          icon={options?.icon}
          fallback={collapsed ? ChevronsRight : ChevronsLeft}
          className="size-[var(--t-space-iconSmall)]"
        />
      </span>
    </button>
  );
}

export function AppUiScale({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showLabel = options?.showLabel !== false;
  const showValue = options?.showValue !== false;
  const label = typeof options?.label === "string" ? options.label : "UI Scale";

  const changeScale = (next: number) => {
    void setUiScale(next).catch(() => {});
    setSetting("uiScale", next);
  };

  const pct = Math.round(uiScale * 100);

  return (
    <div data-el="app.uiScale" className={className ?? "flex items-center gap-[var(--t-space-inlineGap)]"} style={style}>
      {showLabel && (
        <span data-part="label" className="[font-size:var(--t-type-caption-size)] text-muted">
          {label}
        </span>
      )}
      <div data-part="track" className="relative flex items-center">
        <input
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          value={uiScale}
          onChange={(e) => changeScale(Number(e.target.value))}
          aria-label={label}
          data-part="knob"
          className="h-1 cursor-pointer accent-accent"
        />
      </div>
      {showValue && (
        <span data-part="value" className="[font-size:var(--t-type-caption-size)] font-mono-data text-muted">
          {pct}%
        </span>
      )}
    </div>
  );
}

export function AppSchemeToggle({ options, className, style }: OptionsProps) {
  const scheme = useThemeStore((s) => s.scheme);
  const setScheme = useThemeStore((s) => s.setScheme);

  const toggle = () => {
    setScheme(scheme === "dark" ? "light" : "dark");
  };

  return (
    <button
      type="button"
      data-el="app.schemeToggle"
      data-state={scheme}
      onClick={toggle}
      title={scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className={className}
      style={style}
    >
      <span data-part="icon">
        <OptionIcon
          icon={options?.icon}
          fallback={scheme === "dark" ? Sun : Moon}
          className="size-[var(--t-space-iconSmall)]"
        />
      </span>
    </button>
  );
}
