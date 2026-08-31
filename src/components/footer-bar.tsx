import { useSettingsStore } from "@/stores/settings-store";
import { setUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface FooterBarProps {
  servers: number;
  populated: number;
  refreshedAt: string | null;
  steamConnected: boolean;
}

// Segmented footer: Steam state chip, mono stats, and the interface-scale track/knob.
export function FooterBar({ servers, populated, refreshedAt, steamConnected }: FooterBarProps) {
  const uiScale = useSettingsStore((s) => s.uiScale);
  const setSetting = useSettingsStore((s) => s.setSetting);

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
