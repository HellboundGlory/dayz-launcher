import { useSettingsStore } from "@/stores/settings-store";
import { setUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "@/lib/tauri";

interface FooterBarProps {
  servers: number;
  populated: number;
  refreshedAt: string | null;
  steamConnected: boolean;
}

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

  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#1e293b] bg-[#0b0f17] px-3 py-1">
      {/* Left: Stats */}
      <div className="flex min-w-0 items-center gap-2 truncate text-[10px] text-[#64748b]">
        {steamConnected ? (
          <>
            <span className="font-mono-data">{servers.toLocaleString()} servers</span>
            <span className="text-[#1e293b]">·</span>
            <span className="font-mono-data">{populated.toLocaleString()} populated</span>
          </>
        ) : (
          <span>Steam not connected — server discovery unavailable</span>
        )}
        {refreshedAt && (
          <>
            <span className="text-[#1e293b]">·</span>
            <span>refreshed {refreshedAt}</span>
          </>
        )}
      </div>

      {/* Right: interface scale. Lives here rather than in Settings because it
          is the one control you want to adjust while looking at the thing it
          changes, and the status bar is always on screen. */}
      <label className="flex shrink-0 items-center gap-2 text-[10px] text-[#7c8ba1]">
        <span className="uppercase tracking-wider">Scale</span>
        <input
          type="range"
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          value={uiScale}
          onChange={(e) => changeScale(Number(e.target.value))}
          title="Size of everything in the launcher"
          className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-[#1e293b] accent-[#38bdf8]"
        />
        <span className="w-8 text-right font-mono-data tabular-nums text-[#94a3b8]">
          {Math.round(uiScale * 100)}%
        </span>
      </label>
    </div>
  );
}
