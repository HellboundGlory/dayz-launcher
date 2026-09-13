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
  const hidden = new Set(slot.hidden);

  // Applies immediately (cheap); setSetting persists on its own debounce.
  function changeScale(next: number) {
    void setUiScale(next).catch((e) => console.error("Failed to set UI scale:", e));
    setSetting("uiScale", next);
  }

  // Wide track (120px) so each of the 10 scale steps stays grabbable.
  const TRACK_PX = 120;
  const KNOB_PX = 7;
  const knobLeft =
    ((uiScale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN)) * (TRACK_PX - KNOB_PX);

  const children: Record<string, ReactNode> = {
    steamStateChip: (
      <div
        data-tetra-el="steamStateChip"
        className={cn(
          "f2-state flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[9px] font-semibold",
          steamConnected
            ? "border-success bg-accent-soft text-success"
            : "border-warn bg-warn-soft text-warn",
        )}
      >
        <span
          className={cn(
            "size-[5px] rounded-full",
            steamConnected ? "bg-success shadow-[var(--glow)]" : "bg-warn shadow-[0_0_4px_var(--warn)]",
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
        className="f2-stats flex min-w-0 flex-1 items-center gap-2 font-mono-data text-[10px] text-muted"
      >
        <span>
          <em className="font-semibold not-italic text-muted2">{servers.toLocaleString()}</em>{" "}
          servers
        </span>
        <span className="sep text-line">·</span>
        <span>
          <em className="font-semibold not-italic text-muted2">
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
              <em className="font-semibold not-italic text-muted2">
                {listSource === "index" ? "index" : "Steam"}
              </em>
            </span>
          </>
        )}
        {refreshedAt && (
          <>
            <span className="sep text-line">·</span>
            <span>
              refreshed <em className="font-semibold not-italic text-muted2">{refreshedAt}</em>
            </span>
          </>
        )}
      </div>
    ),

    uiScaleSlider: (
      <label
        data-tetra-el="uiScaleSlider"
        className="f2-scale ml-auto flex shrink-0 items-center gap-2 text-[9px] uppercase tracking-[0.05em] text-muted2"
      >
        <span className="lbl font-bold">Scale</span>
        <span className="track relative h-[3px] w-[120px] rounded-[2px] bg-line">
          <span
            className="knob absolute left-0 top-1/2 h-[7px] w-[7px] rounded-full bg-accent shadow-[var(--glow)] transition-transform duration-150"
            style={{ transform: `translate(${knobLeft}px, -50%)` }}
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
            className="absolute inset-0 h-full w-full cursor-pointer rounded-[2px] opacity-0"
          />
        </span>
        <span className="val w-9 text-right font-mono-data text-[9px] normal-case tracking-normal text-muted2">
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
        className="f2-scheme flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-muted2 transition-colors hover:text-ink"
      >
        {scheme === "dark" ? (
          <Sun className="h-[14px] w-[14px]" strokeWidth={1.6} />
        ) : (
          <Moon className="h-[14px] w-[14px]" strokeWidth={1.6} />
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
      className="footer-v2 flex shrink-0 items-center gap-3.5 border-t border-line bg-surface px-3.5 py-[7px]"
    >
      {order.map((id) => {
        if (hidden.has(id) && !REQUIRED_IDS[id]) return null;
        return (
          <Fragment key={id}>
            {children[id]}
            {/* Decorative rule, not a registered child: it stays beside the chip. */}
            {id === "steamStateChip" && <div className="f2-vrule h-3.5 w-px shrink-0 bg-line" />}
          </Fragment>
        );
      })}
    </div>
  );
}
