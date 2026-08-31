import splashBg from "@/assets/dayz-splashscreen.png";
import tetraLogo from "@/assets/tetra-logo.png";

export interface SplashScreenProps {
  /** Current stage of startup, e.g. "Propagating server list…". */
  status: string;
  /** Optional live detail line, e.g. "Found 1,234 servers". */
  detail?: string;
  /** 0–100. Drives both the bottom bar fill and the % readout. */
  pct: number;
}

// Branded splash inside the transparent 860×484 splash window — no opaque
// backdrop, so the PNG's rounded corners show through to the desktop.
export function SplashScreen({ status, detail, pct }: SplashScreenProps) {
  if (pct < 0 || pct > 100) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
      style={{
        backgroundImage: `url(${splashBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Legibility scrim behind the text only — fades out before the corners
          so they stay transparent. pointer-events-none keeps it non-blocking. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 55%, rgba(5,8,15,0.55), transparent 75%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <img src={tetraLogo} alt="" className="size-24" draggable={false} />

        {/* Brand name, mirroring the title-bar's sky/off-white split. */}
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-wide text-[#38bdf8]">
            TETRA
          </span>
          <span className="text-3xl font-medium text-[#f1f5f9]">Launcher</span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-sm font-medium text-[#f1f5f9]">{status}</span>
          {detail && (
            <span className="font-mono-data text-xs tabular-nums text-[#94a3b8]">
              {detail}
            </span>
          )}
        </div>
      </div>

      {/* Bottom-merged progress bar: a full-width 3px track pinned to the edge
          with a sky fill whose width tracks `pct`. The % readout sits just
          above it. `transition-[width]` eases between milestones. */}
      <div className="absolute inset-x-0 bottom-0">
        <div className="mb-1.5 text-center font-mono-data text-xs tabular-nums text-[#f1f5f9]">
          {Math.round(pct)}%
        </div>
        <div className="h-[3px] w-full bg-[#1e293b]/60">
          <div
            className="h-full bg-[#38bdf8] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
