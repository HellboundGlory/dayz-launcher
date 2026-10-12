import { useId, useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { openSteam, type SteamInitError, type SteamInitFailure } from "@/lib/tauri";
import { wrapTabWithin } from "@/theme/interaction/popup-keyboard";

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
  already_initialising: {
    title: "Still connecting",
    body:
      "A connection attempt is already under way. This clears on its own in a moment — no need to do anything.",
    patient: true,
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
  const titleId = useId();
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
    <div className="fixed inset-0 z-[var(--z-blocking)] flex items-center justify-center [background-color:var(--t-color-scrimBlocking)] backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => wrapTabWithin(e.currentTarget, e)}
        className="w-[440px] [border-radius:var(--t-radius-confirm)] border border-line bg-surface [box-shadow:var(--t-shadow-confirm)]"
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <div
            className={`mt-0.5 flex size-8 shrink-0 items-center justify-center [border-radius:var(--t-radius-pill)] ${
              copy.patient ? "bg-accent-soft" : "bg-warn-soft"
            }`}
          >
            {copy.patient ? (
              <LoaderCircle className="size-4 animate-spin text-accent" />
            ) : (
              <TriangleAlert className="size-4 text-warn" />
            )}
          </div>
          <div data-tetra-el="errorCopy">
            <h2 id={titleId} className="[font-size:var(--t-type-heading-size)] font-semibold leading-5 text-ink">{copy.title}</h2>
            <p className="mt-1.5 [font-size:var(--t-type-body-size)] leading-relaxed text-muted2">{copy.body}</p>
          </div>
        </div>

        {error.message && (
          <p className="mx-5 mt-4 truncate [border-radius:var(--t-radius-chip)] bg-bg px-2 py-1.5 font-mono [font-size:var(--t-type-data-size)] text-muted">
            {error.message}
          </p>
        )}

        {startError && <p className="mx-5 mt-2 [font-size:var(--t-type-size-sm)] text-danger">{startError}</p>}

        <div className="mt-5 flex items-center gap-2 border-t border-line px-5 py-3">
          {offerStart && (
            <button
              data-tetra-el="startSteamAction"
              onClick={handleStartSteam}
              className="flex items-center gap-1.5 [border-radius:var(--t-radius-controlSmall)] bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-size-md)] font-semibold text-ink ring-1 ring-line hover:bg-line"
            >
              <ExternalLink className="size-3" />
              Start Steam
            </button>
          )}

          <span className="ml-auto [font-size:var(--t-type-size-sm)] text-muted">
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
              data-tetra-el="retryAction"
              onClick={onRetry}
              disabled={checking}
              className="flex items-center gap-1.5 [border-radius:var(--t-radius-controlSmall)] bg-accent px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-size-md)] font-semibold text-bg hover:brightness-110 disabled:opacity-50"
            >
              {checking ? (
                <LoaderCircle className="size-3 animate-spin" />
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
