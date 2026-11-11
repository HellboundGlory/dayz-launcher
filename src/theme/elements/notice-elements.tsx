import type { CSSProperties } from "react";
import { playerMessage } from "@/lib/player-message";
import { cn } from "@/lib/utils";
import { useElementContext } from "./context";
import { useLaunchStore, type ServerNotice, type LaunchResult } from "@/stores/launch-store";
import { NOTICES } from "@/hooks/use-server-actions";
import { usePopupContext } from "./popup-elements";

export function launchErrorMessage(raw: string): string {
  return playerMessage(raw, "Could not start DayZ. The launcher log has the details.");
}

type ActionNoticeContent =
  | { kind: "code"; code: string; message: string; detail: string; state: "warning" | "error" }
  | { kind: "plain"; message: string; state: "warning" | "success" }
  | { kind: "refusal"; title: string; message: string; state: "error" };

export function resolveActionNoticeContent(
  addr: string,
  storeNotice: ServerNotice | null,
  result: LaunchResult | null,
): ActionNoticeContent | null {
  if (storeNotice && storeNotice.addr === addr) {
    const notice = storeNotice.notice;
    if (notice.kind === "code") {
      const entry = NOTICES[notice.code];
      return {
        kind: "code",
        code: notice.code,
        message: notice.extra ? `${entry.text} · ${notice.extra}` : entry.text,
        detail: entry.detail,
        state: notice.code.startsWith("E") ? "error" : "warning",
      };
    }
    return { kind: "plain", message: notice.text, state: notice.tone === "success" ? "success" : "warning" };
  }

  if (result && result.addr === addr && (result.message || result.error)) {
    if (result.error) {
      return { kind: "refusal", title: "Launch refused", message: launchErrorMessage(result.error), state: "error" };
    }
    return { kind: "plain", message: result.message!, state: "success" };
  }

  return null;
}

export function ServerActionNotice({ className, style }: { className?: string; style?: CSSProperties }) {
  const { subjectContext, selectedServer, contextName } = useElementContext();
  const { popupId } = usePopupContext();
  const storeNotice = useLaunchStore((s) => s.notice);
  const result = useLaunchStore((s) => s.result);
  const server = (subjectContext?.kind === "server" ? subjectContext.data : selectedServer) as import("@/types/server").Server | null;
  if (!server) return null;

  // Rows report join results as a toast instead, never inline; a row's popup shows them.
  if (contextName === "row" && !popupId) return null;

  const content = resolveActionNoticeContent(server.addr, storeNotice, result);
  if (!content) return null;

  const stateClass =
    content.state === "error" ? "text-danger" : content.state === "success" ? "text-success" : "text-warn";
  const borderClass =
    content.state === "error"
      ? "border-danger-line"
      : content.state === "success"
        ? "border-success-line"
        : "border-warn-line";

  const leading =
    content.kind === "code" ? (
      <span
        data-part="code"
        title={content.detail}
        className={cn(
          "shrink-0 [border-radius:var(--t-radius-controlSmall)] px-1 font-mono-data [font-size:var(--t-type-size-xs)] font-semibold uppercase",
          stateClass,
          content.state === "error" ? "bg-danger-soft" : "bg-warn-soft",
        )}
      >
        {content.code}
      </span>
    ) : content.kind === "refusal" ? (
      <span data-part="title" className={cn("shrink-0 font-bold uppercase tracking-wider", stateClass)}>
        {content.title}
      </span>
    ) : null;

  return (
    <div
      data-el="server.actionNotice"
      data-state={content.kind === "refusal" ? "error refused" : content.state}
      className={cn("border p-3 my-2", borderClass, className)}
      style={style}
    >
      {content.kind !== "code" && leading && <div className="mb-1">{leading}</div>}
      <div data-part="message" className="[font-size:var(--t-type-size-lg)] leading-4 text-muted2">
        {content.kind === "code" && <>{leading} </>}
        {content.message}
      </div>
    </div>
  );
}
