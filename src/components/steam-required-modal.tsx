import { useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { openSteam, type SteamInitError, type SteamInitFailure } from "@/lib/tauri";

interface SteamRequiredModalProps {
  error: SteamInitError;
  /** A connection attempt is in flight. */
  checking: boolean;
  /** Automatic re-checking has used up its attempts for this failure. */
  exhausted: boolean;
  onRetry: () => void;
}

interface Copy {
  title: string;
  body: string;
  /** Waiting on something rather than reporting a fault. */
  patient?: boolean;
}

// Split per failure kind because the cases need genuinely different instructions.
const COPY: Record<SteamInitFailure, Copy> = {
  steam_not_running: {
    title: "Steam isn't running",
    body:
      "Tetra Launcher needs the Steam client to find servers, check which mods you have, and launch DayZ. Start Steam and sign in — this window closes on its own once it connects.",
  },
  steam_out_of_date: {
    title: "Steam needs updating",
    body:
      "Your Steam client is older than the version DayZ requires. Let Steam finish updating itself, then retry.",
  },
  steam_not_ready: {
    title: "Waiting for Steam",
    body:
      "Steam is running but hasn't finished starting up. This clears by itself once it has signed in — no need to do anything.",
    patient: true,
  },
  internal: {
    title: "Couldn't reach Steam",
    body:
      "The launcher failed to start its Steam connection. Retry, and if it keeps happening, restart the launcher.",
  },
  disconnected: {
    title: "Steam disconnected",
    body:
      "The connection to Steam was lost while the launcher was running. Mod and download status may be out of date. Restart the launcher to reconnect — Retry won't help here, since the existing connection is still reported as open.",
  },
};

// Once auto-retries run out, "still not ready" reads more like a licence
// problem than a slow startup, so the advice flips.
const NOT_READY_EXHAUSTED: Copy = {
  title: "Steam won't start a DayZ session",
  body:
    "Steam has been running for a while and still won't hand DayZ over. Check that the account signed in to Steam actually owns DayZ, then retry.",
};

// Blocking prompt when Steam can't be reached at startup. Deliberately no
// dismiss — a dismissed prompt would leave the mod panel silently treating
// an empty Steam response as "no mods to worry about".
export function SteamRequiredModal({
  error,
  checking,
  exhausted,
  onRetry,
}: SteamRequiredModalProps) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const copy =
    error.kind === "steam_not_ready" && exhausted
      ? NOT_READY_EXHAUSTED
      : (COPY[error.kind] ?? COPY.internal);

  const offerStart = error.kind === "steam_not_running" && !starting;
  const polling = error.autoRetry && !exhausted;
  // A Retry button here would silently "succeed" against the same stale handle.
  const retryDisconnected = error.kind === "disconnected";

  async function handleStartSteam() {
    setStarting(true);
    setStartError(null);
    try {
      await openSteam();
    } catch (e) {
      setStartError(String(e));
      setStarting(false);
    }
    // On success `starting` deliberately stays set until the poll connects,
    // so the button doesn't invite launching Steam repeatedly.
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#0b0f17]/90 backdrop-blur-sm">
      <div className="w-[440px] rounded-lg border border-[#1e293b] bg-[#111823] shadow-2xl">
        <div className="flex items-start gap-3 px-5 pt-5">
          <div
            className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
              copy.patient ? "bg-[#38bdf8]/10" : "bg-[#f59e0b]/10"
            }`}
          >
            {copy.patient ? (
              <Loader2 className="size-4 animate-spin text-[#38bdf8]" />
            ) : (
              <AlertTriangle className="size-4 text-[#f59e0b]" />
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#f1f5f9]">{copy.title}</h2>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#94a3b8]">{copy.body}</p>
          </div>
        </div>

        {error.message && (
          <p className="mx-5 mt-4 truncate rounded bg-[#0b0f17] px-2 py-1.5 font-mono text-[10px] text-[#475569]">
            {error.message}
          </p>
        )}

        {startError && <p className="mx-5 mt-2 text-[10px] text-[#ef4444]">{startError}</p>}

        <div className="mt-5 flex items-center gap-2 border-t border-[#1e293b] px-5 py-3">
          {offerStart && (
            <button
              onClick={handleStartSteam}
              className="flex items-center gap-1.5 rounded bg-[#16202e] px-3 py-1.5 text-[11px] font-semibold text-[#f1f5f9] ring-1 ring-[#1e293b] hover:bg-[#1e293b]"
            >
              <ExternalLink className="size-3" />
              Start Steam
            </button>
          )}

          <span className="ml-auto text-[10px] text-[#64748b]">
            {checking
              ? "Connecting…"
              : polling
                ? "Checking automatically…"
                : retryDisconnected
                  ? "Close the launcher and open it again"
                  : null}
          </span>

          {!retryDisconnected && (
            <button
              onClick={onRetry}
              disabled={checking}
              className="flex items-center gap-1.5 rounded bg-[#38bdf8] px-3 py-1.5 text-[11px] font-semibold text-[#0b0f17] hover:bg-[#7dd3fc] disabled:opacity-50"
            >
              {checking ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
