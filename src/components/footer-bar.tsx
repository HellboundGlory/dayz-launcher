import { Fragment, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import {
  setUiScale,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  type ListSource,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/theme/theme-store";
import { useComponentComposition } from "@/theme/use-component-composition";
import { ComponentTreeRenderer } from "@/theme/component-tree-renderer";
import { useResolvedSlot } from "@/theme/use-resolved-layout";

interface FooterBarProps {
  servers: number;
  populated: number;
  refreshedAt: string | null;
  steamConnected: boolean;
  /** Where the loaded list came from; `null` until a discovery pass finishes. */
  listSource: ListSource | null;
}

/** The slot's children, in the footer's own flex row. `steamStateChip` is
 * required, so it renders even if a broken layout claims to hide it. */
export const FOOTER_IDS = ["steamStateChip", "serverCounts", "uiScaleSlider", "schemeToggle"];

const REQUIRED_IDS: Record<string, true> = { steamStateChip: true };

/** Segmented footer: Steam state chip, mono stats, and the interface-scale track/knob. */
export function FooterBar({
  servers,
  populated,
  refreshedAt,
  steamConnected,
  listSource,
}: FooterBarProps) {
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const scheme = useThemeStore((s) => s.scheme);
  const setScheme = useThemeStore((s) => s.setScheme);
  const slot = useResolvedSlot("shell.footer");
  const activeId = useThemeStore((s) => s.activeId);

  const hidden = new Set(slot.hidden);

  const composition = useComponentComposition("shell.footer");

  // Applies immediately (cheap); setSetting persists on its own debounce.
  function changeScale(next: number) {
    void setUiScale(next).catch((e) => console.error("Failed to set UI scale:", e));
    setSetting("uiScale", next);
  }

  const knobPosition = (uiScale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN);

  const children: Record<string, ReactNode> = {
    steamStateChip: (
      <div
        data-tetra-el="steamStateChip"
        className={cn(
          "f2-state flex shrink-0 items-center gap-[var(--t-space-inlineGap)] [border-radius:var(--t-radius-pill)] border px-[var(--t-space-controlSmallX)] py-[var(--t-space-stateChipY)] [font-size:var(--t-type-caption-size)] [font-weight:var(--t-type-label-weight)]",
          steamConnected
            ? "border-success bg-accent-soft text-success"
            : "border-warn bg-warn-soft text-warn",
        )}
      >
        <span
          className={cn(
            "size-[var(--t-space-stateDotSize)] [border-radius:var(--t-radius-pill)]",
            steamConnected ? "bg-success [box-shadow:var(--t-shadow-glow)]" : "bg-warn [box-shadow:var(--t-shadow-stateWarning)]",
          )}
        />
        {steamConnected ? "Steam connected" : "Steam not connected"}
      </div>
    ),

    // Still gated on the data condition; a layout's `hidden` is a second,
    // independent reason to skip it, not a replacement for this check.
    serverCounts: steamConnected && (
      <div
        data-tetra-el="serverCounts"
        className="f2-stats flex min-w-0 flex-1 items-center gap-[var(--t-space-inlineGapWide)] font-mono-data [font-size:var(--t-type-label-size)] text-muted"
      >
        <span>
          <em className="[font-weight:var(--t-type-label-weight)] not-italic text-muted2">{servers.toLocaleString()}</em>{" "}
          servers
        </span>
        <span className="sep text-line">·</span>
        <span>
          <em className="[font-weight:var(--t-type-label-weight)] not-italic text-muted2">
            {populated.toLocaleString()}
          </em>{" "}
          populated
        </span>
        {listSource && (
          <>
            <span className="sep text-line">·</span>
            <span
              title={
                listSource === "index"
                  ? "Served by Tetra's server index in one request"
                  : "Asked Steam directly — the index was off, unreachable or stale"
              }
            >
              via{" "}
              <em className="[font-weight:var(--t-type-label-weight)] not-italic text-muted2">
                {listSource === "index" ? "index" : "Steam"}
              </em>
            </span>
          </>
        )}
        {refreshedAt && (
          <>
            <span className="sep text-line">·</span>
            <span>
              refreshed <em className="[font-weight:var(--t-type-label-weight)] not-italic text-muted2">{refreshedAt}</em>
            </span>
          </>
        )}
      </div>
    ),

    uiScaleSlider: (
      <label
        data-tetra-el="uiScaleSlider"
        className="f2-scale ml-auto flex shrink-0 items-center gap-[var(--t-space-inlineGapWide)] [font-size:var(--t-type-caption-size)] uppercase [letter-spacing:var(--t-type-button-tracking)] text-muted2"
      >
        <span className="lbl [font-weight:var(--t-type-button-weight)]">Scale</span>
        <span className="track relative h-[var(--t-space-sliderHeight)] w-[var(--t-space-scaleTrackWidth)] [border-radius:var(--t-radius-track)] bg-line">
          <span
            className="knob absolute left-0 top-1/2 h-[var(--t-space-scaleKnobSize)] w-[var(--t-space-scaleKnobSize)] [border-radius:var(--t-radius-pill)] bg-accent [box-shadow:var(--t-shadow-glow)] transition-transform [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] "
            style={{ transform: `translate(calc(${knobPosition} * (var(--t-space-scaleTrackWidth) - var(--t-space-scaleKnobSize))), -50%)` }}
          />
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={UI_SCALE_STEP}
            value={uiScale}
            onChange={(e) => changeScale(Number(e.target.value))}
            aria-label="Interface scale"
            title="Size of everything in the launcher"
            className="absolute inset-0 h-full w-full cursor-pointer [border-radius:var(--t-radius-track)] opacity-0"
          />
        </span>
        <span className="val w-[var(--t-space-dataWidth)] text-right font-mono-data [font-size:var(--t-type-caption-size)] normal-case [letter-spacing:var(--t-type-data-tracking)] text-muted2">
          {Math.round(uiScale * 100)}%
        </span>
      </label>
    ),

    schemeToggle: (
      <button
        type="button"
        data-tetra-el="schemeToggle"
        onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
        aria-label={scheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={scheme === "dark" ? "Lighten the launcher theme" : "Darken the launcher theme"}
        className="f2-scheme flex h-[var(--t-space-iconBox)] w-[var(--t-space-iconBox)] shrink-0 items-center justify-center [border-radius:var(--t-radius-pill)] text-muted2 transition-colors [transition-duration:var(--t-motion-hover-duration)] [transition-timing-function:var(--t-motion-hover-easing)] hover:text-ink"
      >
        {scheme === "dark" ? (
          <Sun className="h-[var(--t-space-iconMedium)] w-[var(--t-space-iconMedium)]" strokeWidth={1.6} />
        ) : (
          <Moon className="h-[var(--t-space-iconMedium)] w-[var(--t-space-iconMedium)]" strokeWidth={1.6} />
        )}
      </button>
    ),
  };

  const order = [
    ...slot.children.filter((id) => FOOTER_IDS.includes(id)),
    ...FOOTER_IDS.filter((id) => !slot.children.includes(id)),
  ];

  return (
    <div
      data-tetra-slot="shell.footer"
      className="footer-v2 flex shrink-0 items-center gap-[var(--t-space-footerGap)] border-t border-line bg-surface px-[var(--t-space-footerX)] py-[var(--t-space-footerY)]"
    >
      {composition !== null ? (
        <ComponentTreeRenderer node={composition} nodes={children} themeId={activeId} />
      ) : (
        order.map((id) => {
          if (hidden.has(id) && !REQUIRED_IDS[id]) return null;
          return (
            <Fragment key={id}>
              {children[id]}
              {/* Decorative rule, not a registered child: it stays beside the chip. */}
              {id === "steamStateChip" && <div className="f2-vrule h-[var(--t-space-iconMedium)] w-[var(--t-border-hairline)] shrink-0 bg-line" />}
            </Fragment>
          );
        })
      )}
    </div>
  );
}
