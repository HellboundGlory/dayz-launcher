import { useState, type CSSProperties } from "react";
import { TriangleAlert, LoaderCircle } from "lucide-react";
import { useServerActions } from "@/hooks/use-server-actions";
import { fixDifferingMods, differingWording } from "@/hooks/fix-differing-mods";
import { useServerSubject } from "./server-elements";
import { useServerReadiness } from "./use-server-readiness";
import { states } from "./element-utils";

export function ServerModDiffers({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  const { readiness } = useServerReadiness(server);
  const { op, dayzUp, verifyAndJoin } = useServerActions();
  const [busy, setBusy] = useState(false);

  // A list row fetches no readiness, so this stays empty there and renders nothing.
  const differing = (readiness?.mods ?? []).filter((m) => m.state === "ready" && m.differs);
  if (!server || differing.length === 0) return null;

  const ids = differing.map((m) => m.workshop_id);
  const working = busy || op !== null;
  const wording = differingWording(differing.length);

  const handleFix = () => {
    if (working || dayzUp) return;
    setBusy(true);
    void fixDifferingMods(server, ids, (s) => verifyAndJoin(s)).finally(() => setBusy(false));
  };

  return (
    <div
      data-el="server.modDiffers"
      data-state={states(working && "busy")}
      className={
        className ??
        "flex items-start gap-2 rounded-[var(--t-radius-control)] border [border-color:color-mix(in_srgb,var(--warn)_45%,transparent)] [background-color:color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 [font-size:var(--t-type-body-size)] leading-snug text-ink"
      }
      style={style}
    >
      <TriangleAlert data-part="icon" aria-hidden className="size-4 shrink-0 text-warn" />
      <span data-part="text" className="flex-1">
        {wording}
      </span>
      <button
        type="button"
        data-part="fix"
        disabled={working || dayzUp}
        onClick={handleFix}
        className="shrink-0 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2 py-1 [font-size:var(--t-type-label-size)] font-semibold text-ink transition-colors hover:border-accent disabled:opacity-50"
      >
        {working ? (
          <>
            <LoaderCircle className="mr-1 inline size-3 animate-spin" aria-hidden />
            Fixing…
          </>
        ) : (
          "Fix and join"
        )}
      </button>
    </div>
  );
}
