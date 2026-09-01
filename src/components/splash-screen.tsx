import splashBg from "@/assets/dayz-splashscreen.png";
import tetraLogo from "@/assets/tetra-logo.png";
import { cn } from "@/lib/utils";

export interface SplashScreenProps {
  /** Current stage of startup, e.g. "Propagating server list…". */
  status: string;
  /** Optional live detail line, e.g. "Found 1,234 servers". */
  detail?: string;
  /** 0–100. Drives both the signal meter and the % readout. */
  pct: number;
}

/** Segments in the bottom-right signal-strength progress meter. */
const TICK_COUNT = 5;

const CORNERS = [
  { key: "tl", cls: "left-3 top-3 border-l border-t" },
  { key: "tr", cls: "right-3 top-3 border-r border-t" },
  { key: "bl", cls: "bottom-3 left-3 border-b border-l" },
  { key: "br", cls: "bottom-3 right-3 border-b border-r" },
] as const;

// Branded splash inside the transparent 672×378 splash window — no opaque
// backdrop, so the PNG's alpha-punched corners show through to the desktop.
// Tactical-readout treatment: logo demoted to a corner lockup, status read
// as a telemetry line, progress as a signal meter rather than a bar.
export function SplashScreen({ status, detail, pct }: SplashScreenProps) {
  if (pct < 0 || pct > 100) return null;

  const litTicks = Math.round((pct / 100) * TICK_COUNT);

  return (
    <div className="fixed inset-0 z-[100] select-none overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${splashBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "saturate(0.5) brightness(0.8) contrast(1.05)",
        }}
      />

      {/* Legibility scrim, heaviest where the readout text sits. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(5,8,15,0.55) 0%, rgba(5,8,15,0.15) 30%, rgba(5,8,15,0.15) 65%, rgba(5,8,15,0.65) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.28]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0px, rgba(0,0,0,0.35) 1px, transparent 1px, transparent 3px)",
        }}
      />

      {CORNERS.map(({ key, cls }) => (
        <span
          key={key}
          className={cn("pointer-events-none absolute h-4 w-4 border-accent-line", cls)}
        />
      ))}

      <div className="absolute left-4 top-4 flex items-center gap-2">
        <img
          src={tetraLogo}
          alt=""
          draggable={false}
          className="size-5 rounded-[4px] shadow-[var(--glow)]"
        />
        <span className="font-mono-data text-[9.5px] font-bold tracking-[0.1em] text-[#c7d2df]">
          TETRA <span className="text-accent">//</span> LAUNCHER
        </span>
      </div>

      <div className="absolute bottom-4 left-4 flex max-w-[62%] flex-col gap-1">
        <span className="truncate font-mono-data text-[11px] tracking-[0.03em] text-accent">
          {"> "}
          {status.replace(/…$/, "").toUpperCase()}
          <span className="motion-safe:animate-pulse">_</span>
        </span>
        {detail && (
          <span className="truncate font-mono-data text-[9px] tracking-[0.02em] text-[#c7d2df]/60">
            {detail.toUpperCase()}
          </span>
        )}
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <div className="flex items-end gap-[3px]">
          {Array.from({ length: TICK_COUNT }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "block w-[4px] rounded-[1px] transition-colors duration-300",
                i < litTicks ? "bg-accent shadow-[0_0_5px_rgba(143,163,189,0.7)]" : "bg-white/15",
              )}
              style={{ height: `${8 + i * 2.5}px` }}
            />
          ))}
        </div>
        <span className="font-mono-data text-[11px] tabular-nums text-[#e7ebf0]">
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}
