import type { CSSProperties } from "react";
import { TriangleAlert } from "lucide-react";
import { useInstalledDayzVersion } from "@/hooks/use-filter-facets";
import { versionMismatch } from "@/lib/game-version";
import { useServerSubject } from "./server-elements";

export function ServerVersionWarning({ className, style }: { className?: string; style?: CSSProperties }) {
  const server = useServerSubject();
  const installed = useInstalledDayzVersion();
  if (!server) return null;

  const mismatch = versionMismatch(server.version, installed);
  if (!mismatch) return null;

  const wording = `Server runs ${mismatch.server}, you have ${mismatch.yours}`;

  return (
    <span
      data-el="server.versionWarning"
      role="img"
      aria-label={wording}
      title={wording}
      className={className ?? "inline-flex shrink-0 items-center text-warn"}
      style={style}
    >
      <TriangleAlert data-part="icon" aria-hidden className="size-3.5 shrink-0" />
    </span>
  );
}
