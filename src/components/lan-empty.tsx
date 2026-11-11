import { LoaderCircle, Network, RefreshCw } from "lucide-react";
import { useLanStore } from "@/stores/lan-store";

/** The LAN tab's empty state: looking, found nothing, or could not look. */
export function LanEmpty() {
  const state = useLanStore((s) => s.state);
  const scan = useLanStore((s) => s.scan);

  return (
    <div
      data-el="lan.empty"
      data-state={state}
      className="flex min-h-0 flex-1 items-center justify-center p-[var(--t-space-controlX)] text-center"
    >
      <div className="grid max-w-[420px] justify-items-center gap-[var(--t-space-inlineGapWide)]">
        {state === "scanning" ? (
          <>
            <LoaderCircle aria-hidden className="size-8 text-muted motion-safe:animate-spin" />
            <p data-part="looking" className="m-0 [font-size:var(--t-type-body-size)] text-muted2">
              Looking on your network…
            </p>
          </>
        ) : (
          <>
            <Network aria-hidden className="size-8 text-muted" strokeWidth={1.4} />
            {state === "failed" ? (
              <p data-part="failed" className="m-0 [font-size:var(--t-type-body-size)] text-danger">
                Could not look on the network.
              </p>
            ) : (
              <>
                <h3 data-part="title" className="m-0 [font-size:var(--t-type-subheading-size)] font-semibold text-ink">
                  No servers on your network
                </h3>
                <p data-part="note" className="m-0 [font-size:var(--t-type-size-sm)] leading-relaxed text-muted2">
                  Tetra looked on every network this PC is on. A server on another subnet or behind a VPN won't show
                  up here; add it by address with the + button instead.
                </p>
              </>
            )}
            <button
              type="button"
              data-part="again"
              onClick={() => void scan()}
              className="flex h-8 items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] [font-size:var(--t-type-size-md)] font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Look again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
