import { useSettingsStore } from "@/stores/settings-store";
import { setUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface FooterBarProps {
  servers: number;
  populated: number;
  refreshedAt: string | null;
  steamConnected: boolean;
}

/**
 * V2 segmented footer: Steam state chip, mono stats, and the interface-scale
 * track/knob (the one control you adjust while looking at what it changes).
 */
export function FooterBar({ servers, populated, refreshedAt, steamConnected }: FooterBarProps) {
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setSetting = useSettingsStore((s) => s.setSetting);

  /**
   * Apply immediately, persist on the store's own debounce.
   *
   * Two separate calls on purpose: the zoom has to track the thumb to be worth
   * dragging, but `setSetting` behind it would mean a settings write and a file
   * rewrite for every pixel of travel. `set_ui_scale` is the cheap half.
   */
  function changeScale(next: number) {
    void setUiScale(next).catch((e) => console.error("Failed to set UI scale:", e));
    setSetting("uiScale", next);
  }

  // Knob travels the usable track length. The track is deliberately wide
  // (120px): 1.0→1.5 in 10 steps needs ~11px per step to stay grabbable; the
  // original 46px made each step ~4px and the slider felt hair-trigger.
  const TRACK_PX = 120;
  const KNOB_PX = 7;
  const knobLeft =
    ((uiScale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN)) * (TRACK_PX - KNOB_PX);

  return (
    <div className="footer-v2 flex shrink-0 items-center gap-3.5 border-t border-line bg-surface px-3.5 py-[7px]">
      <div
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

      <div className="f2-vrule h-3.5 w-px shrink-0 bg-line" />

      {steamConnected && (
        <div className="f2-stats flex min-w-0 flex-1 items-center gap-2 font-mono-data text-[10px] text-muted">
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
          {refreshedAt && (
            <>
              <span className="sep text-line">·</span>
              <span>
                refreshed <em className="font-semibold not-italic text-muted2">{refreshedAt}</em>
              </span>
            </>
          )}
        </div>
      )}

      <label className="f2-scale ml-auto flex shrink-0 items-center gap-2 text-[9px] uppercase tracking-[0.05em] text-muted2">
        <span className="lbl font-bold">Scale</span>
        <span className="track relative h-[3px] w-[120px] rounded-[2px] bg-line">
          <span
            className="knob absolute top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-accent shadow-[var(--glow)] transition-[left] duration-150"
            style={{ left: `${knobLeft}px` }}
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
    </div>
  );
}
