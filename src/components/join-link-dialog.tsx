import { useEffect, useId, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, Download, LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { lookUpJoinLink } from "@/hooks/use-join-links";
import { useServerActions } from "@/hooks/use-server-actions";
import { checkServerMods } from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import { useJoinLinkStore, type JoinLinkPhase, type JoinLinkRequest } from "@/stores/join-link-store";
import { useLaunchStore } from "@/stores/launch-store";
import { setCachedReadiness } from "@/stores/readiness-store";
import { useServerStore } from "@/stores/server-store";
import { ServerModsListHost } from "@/theme/elements/list-elements";
import { SubjectContextProvider } from "@/theme/elements/context";
import { computeReadinessView } from "@/theme/elements/readiness-elements";
import { ServerFavourite } from "@/theme/elements/server-elements";
import { isOutstandingMod, useServerReadiness } from "@/theme/elements/use-server-readiness";
import { useEscapeLayer } from "@/theme/interaction/escape-layers";
import { wrapTabWithin } from "@/theme/interaction/popup-keyboard";
import type { Server, ServerModReadiness } from "@/types/server";

const SECONDARY =
  "flex items-center gap-1.5 [border-radius:var(--t-radius-controlSmall)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-size-md)] font-semibold text-ink hover:bg-line";
const PRIMARY =
  "flex items-center gap-1.5 [border-radius:var(--t-radius-controlSmall)] bg-accent px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-size-md)] font-semibold text-bg hover:brightness-110 disabled:opacity-50";
const TONE = {
  info: "bg-accent-soft",
  warn: "bg-warn-soft",
  bad: "bg-danger-soft",
};

interface Status {
  tone: keyof typeof TONE;
  icon: ReactNode;
  head: string;
  sub?: string;
}

interface JoinLinkBoxProps {
  request: JoinLinkRequest;
  phase: JoinLinkPhase;
  server: Server | null;
  readiness: ServerModReadiness | null;
  /** Mods are being checked for `server`. */
  checking: boolean;
  dayzRunning: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onJoin: () => void;
}

export function JoinLinkBox({
  request,
  phase,
  server,
  readiness,
  checking,
  dayzRunning,
  onCancel,
  onRetry,
  onJoin,
}: JoinLinkBoxProps) {
  const titleId = useId();
  const addr = `${request.ip}:${request.port}`;
  const mods = readiness?.mods ?? [];
  const outstanding = mods.filter(isOutstandingMod).length;
  const size = computeReadinessView(readiness, false);
  const ping = server && server.ping !== null ? `${server.ping} ms` : "—";

  const spinner = <LoaderCircle className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin text-accent" />;
  const warning = <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />;

  let status: Status | null;
  let joinLabel = "Join";
  let joinIcon: ReactNode = <Play className="size-3.5" />;
  let joinDisabled = true;

  if (phase === "noanswer") {
    status = {
      tone: "bad",
      icon: <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />,
      head: `${addr} did not answer`,
      sub: "It may be offline, or the link has the wrong address.",
    };
  } else if (phase === "asking") {
    status = {
      tone: "info",
      icon: spinner,
      head: `Asking ${addr} for its details…`,
      sub: "It is not in your server list yet, so the launcher asks it directly.",
    };
  } else if (dayzRunning) {
    status = { tone: "warn", icon: warning, head: "DayZ is already running", sub: "Close DayZ, then press Join." };
  } else if (checking) {
    status = { tone: "info", icon: spinner, head: "Checking this server's mods…" };
  } else if (outstanding > 0) {
    const bytes =
      size.sizeBytes === null ? "" : ` · ${size.sizeIsUpperBound ? "up to " : ""}${formatBytes(size.sizeBytes)}`;
    status = {
      tone: "warn",
      icon: warning,
      head: `${outstanding} of ${mods.length} ${mods.length === 1 ? "mod needs" : "mods need"} downloading${bytes}`,
      sub: "Steam downloads them, then DayZ starts on this server.",
    };
    joinLabel = `Download ${outstanding} ${outstanding === 1 ? "mod" : "mods"} and join`;
    joinIcon = <Download className="size-3.5" />;
    joinDisabled = false;
  } else {
    status =
      mods.length > 0
        ? {
            tone: "info",
            icon: <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />,
            head: `All ${mods.length} ${mods.length === 1 ? "mod is" : "mods are"} ready`,
          }
        : null;
    joinDisabled = false;
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 [background-color:var(--t-color-scrim)]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => wrapTabWithin(e.currentTarget, e)}
        className="flex w-[min(460px,100%)] flex-col [border-radius:var(--t-radius-confirm)] border border-line bg-surface [box-shadow:var(--t-shadow-confirm)]"
      >
        <div className="grid gap-0.5 px-4 pt-4">
          <h2 id={titleId} className="[font-size:var(--t-type-heading-size)] font-semibold leading-5 text-ink">
            Join this server?
          </h2>
          <p className="[font-size:var(--t-type-size-sm)] text-muted">Opened from a join link</p>
        </div>

        <SubjectContextProvider subject={server && { kind: "server", data: server }} contextName="modal">
          <div className="grid gap-3 px-4 py-3.5">
            <div className="grid min-w-0 gap-1.5 border border-line bg-surface2 p-3 [border-radius:var(--t-radius-control)]">
              <div className="flex min-w-0 items-start gap-2">
                <p className={`min-w-0 flex-1 break-words font-semibold ${server ? "text-ink" : "text-muted2"}`}>
                  {server ? server.name : phase === "asking" ? "Looking up the server…" : "Unknown server"}
                </p>
                {server && (
                  <ServerFavourite className="flex shrink-0 items-center justify-center text-muted hover:text-warn" />
                )}
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono tabular-nums text-muted2 [font-size:var(--t-type-data-size)]">
                {server && <span>Map <span className="text-ink">{server.map_display}</span></span>}
                {server && <span>Players <span className="text-ink">{server.players}/{server.max_players}</span></span>}
                {server && <span>Ping <span className="text-ink">{ping}</span></span>}
                <span>{server && server.game_port > 0 ? `${request.ip}:${server.game_port}` : addr}</span>
              </div>
            </div>

            {status && (
              <div
                role="status"
                className={`flex items-start gap-2.5 px-3 py-2.5 [border-radius:var(--t-radius-control)] [font-size:var(--t-type-body-size)] ${TONE[status.tone]}`}
              >
                {status.icon}
                <div>
                  {status.head}
                  {status.sub && <small className="block text-muted2 [font-size:var(--t-type-size-sm)]">{status.sub}</small>}
                </div>
              </div>
            )}

            {server?.modded && (
              <ServerModsListHost
                options={{ header: false }}
                className="flex min-h-0 max-h-56 flex-col overflow-hidden"
              />
            )}
          </div>
        </SubjectContextProvider>

        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-line px-4 py-3">
          {phase !== "noanswer" && (
            <p className="mr-auto min-w-0 flex-1 basis-48 text-muted [font-size:var(--t-type-size-sm)]">
              Nothing downloads or starts until you press Join.
            </p>
          )}
          <div className="flex shrink-0 gap-2">
            {phase === "noanswer" ? (
              <>
                <button type="button" autoFocus onClick={onCancel} className={SECONDARY}>
                  Close
                </button>
                <button type="button" onClick={onRetry} className={PRIMARY}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <button type="button" autoFocus onClick={onCancel} className={SECONDARY}>
                  Cancel
                </button>
                <button type="button" disabled={joinDisabled} onClick={onJoin} className={PRIMARY}>
                  {joinIcon}
                  {joinLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The join box, open while a `dzsa://connect` link is waiting on the player. */
export function JoinLinkDialog() {
  const request = useJoinLinkStore((s) => s.request);
  if (!request) return null;
  return <OpenJoinLink request={request} />;
}

function OpenJoinLink({ request }: { request: JoinLinkRequest }) {
  const phase = useJoinLinkStore((s) => s.phase);
  const found = useJoinLinkStore((s) => s.server);
  // The selection is the copy the star toggles, so it keeps the favourite flag current.
  const selected = useServerStore((s) => (s.selectedServer?.addr === found?.addr ? s.selectedServer : null));
  const server = selected ?? found;
  const close = useJoinLinkStore((s) => s.close);
  const { readiness, loading } = useServerReadiness(server);
  // The stored mod list can be empty or stale for a server the list never refreshed, so ask it directly.
  const [liveCheck, setLiveCheck] = useState(false);
  const foundAddr = found?.addr;
  const foundPort = found?.query_port;
  useEffect(() => {
    if (foundAddr === undefined || foundPort === undefined) return;
    let current = true;
    setLiveCheck(true);
    checkServerMods(foundAddr, foundPort)
      .then((res) => current && setCachedReadiness(foundAddr, foundPort, res))
      .catch(() => {})
      .finally(() => current && setLiveCheck(false));
    return () => {
      current = false;
    };
  }, [foundAddr, foundPort]);
  const dayzRunning = useLaunchStore((s) => s.dayzRunning);
  const { verifyAndJoin } = useServerActions();
  useEscapeLayer(true, close);

  return (
    <JoinLinkBox
      request={request}
      phase={phase}
      server={server}
      readiness={readiness}
      checking={loading || liveCheck}
      dayzRunning={dayzRunning}
      onCancel={close}
      onRetry={() => lookUpJoinLink(request)}
      onJoin={() => {
        if (!server) return;
        close();
        void verifyAndJoin(server);
      }}
    />
  );
}
