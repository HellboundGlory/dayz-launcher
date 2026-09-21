import type { CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { useElementContext } from "./context";
import { useLaunchStore, type ServerNotice, type LaunchResult } from "@/stores/launch-store";
import { useModsStore, visibleRows } from "@/stores/mods-store";
import { NOTICES } from "@/hooks/use-server-actions";

export function NoticeStorage({ className, style }: { className?: string; style?: CSSProperties }) {
  const { storageDegraded } = useElementContext();
  if (!storageDegraded) return null;

  return (
    <div
      data-el="notice.storage"
      aria-live="polite"
      className={className ?? "flex items-center gap-[var(--t-space-inlineGapWide)] border-b border-warn bg-warn-soft px-[var(--t-space-rowX)] py-[var(--t-space-controlY)]"}
      style={style}
    >
      <span data-part="tag" className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-warn">
        STORAGE
      </span>
      <span data-part="message" className="[font-size:var(--t-type-body-size)] text-ink">
        The server database could not be opened, so this session is running from memory — favourites and recently-played will not be saved.
      </span>
    </div>
  );
}

export function NoticeError({ className, style }: { className?: string; style?: CSSProperties }) {
  const { error, dismissError } = useElementContext();
  if (!error) return null;

  return (
    <div
      data-el="notice.error"
      role="alert"
      className={className ?? "flex items-center gap-[var(--t-space-inlineGapWide)] border-b border-danger bg-surface2 px-[var(--t-space-rowX)] py-[var(--t-space-controlY)]"}
      style={style}
    >
      <span data-part="tag" className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-danger">
        ERROR
      </span>
      <span data-part="message" className="truncate [font-size:var(--t-type-body-size)] text-ink">
        {error}
      </span>
      <button
        type="button"
        data-part="dismiss"
        onClick={dismissError}
        className="ml-auto shrink-0 [font-size:var(--t-type-label-size)] text-muted hover:text-ink"
      >
        DISMISS
      </button>
    </div>
  );
}

export function NoticeUpdate({ className, style }: { className?: string; style?: CSSProperties }) {
  const { updateAvailable, updateBannerDismissed, dismissUpdateBanner, openUpdateModal } =
    useElementContext();
  if (!updateAvailable || updateBannerDismissed) return null;

  return (
    <div
      data-el="notice.update"
      aria-live="polite"
      className={className ?? "flex items-center gap-[var(--t-space-stackGap)] border-b border-accent-line bg-accent-soft px-[var(--t-space-rowX)] py-[var(--t-space-controlY)]"}
      style={style}
    >
      <span data-part="title" className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-accent">
        Update available
      </span>
      <span data-part="message" className="min-w-0 flex-1 truncate [font-size:var(--t-type-body-size)] text-ink">
        Tetra Launcher v{updateAvailable.version} is ready to install.
      </span>
      <button
        type="button"
        data-part="update"
        onClick={() => {
          dismissUpdateBanner();
          openUpdateModal();
        }}
        className="shrink-0 [border-radius:var(--t-radius-controlSmall)] bg-accent px-[var(--t-space-controlSmallX)] py-[var(--t-space-controlSmallY)] [font-size:var(--t-type-label-size)] [font-weight:var(--t-type-button-weight)] uppercase text-bg"
      >
        Update
      </button>
      <button
        type="button"
        data-part="later"
        onClick={dismissUpdateBanner}
        className="shrink-0 [border-radius:var(--t-radius-controlSmall)] px-[var(--t-space-controlCompactX)] py-[var(--t-space-controlSmallY)] [font-size:var(--t-type-label-size)] uppercase text-muted hover:text-ink"
      >
        Later
      </button>
    </div>
  );
}

export function NoticeModsError({ className, style }: { className?: string; style?: CSSProperties }) {
  const error = useModsStore((s) => s.error);
  if (!error) return null;
  return (
    <div
      data-el="notice.modsError"
      role="alert"
      className={className ?? "border-b border-danger-line bg-danger-soft px-3 py-1.5 [font-size:var(--t-type-body-size)] text-danger"}
      style={style}
    >
      <span data-part="message">{error}</span>
    </div>
  );
}

export function NoticeModsCached({ className, style }: { className?: string; style?: CSSProperties }) {
  const fromCache = useModsStore((s) => s.fromCache);
  if (!fromCache) return null;
  return (
    <div
      data-el="notice.modsCached"
      className={className ?? "border-b border-warn bg-warn-soft px-3 py-1.5 [font-size:var(--t-type-label-size)] uppercase tracking-wider text-warn"}
      style={style}
    >
      <span data-part="message">Steam unreachable — showing last known mod list</span>
    </div>
  );
}

/** Mirrors ModsActionBar's result strip wording: the last VERIFY / unsubscribe / unique-select outcome. */
export function NoticeModsResult({ className, style }: { className?: string; style?: CSSProperties }) {
  const store = useModsStore(
    useShallow((s) => ({
      verifyResult: s.verifyResult,
      mutationFailures: s.mutationFailures,
      uniqueResult: s.uniqueResult,
      clearVerifyResult: s.clearVerifyResult,
      clearMutationFailures: s.clearMutationFailures,
      clearUniqueResult: s.clearUniqueResult,
    })),
  );
  const { verifyResult, mutationFailures, uniqueResult } = store;
  if (!verifyResult && !mutationFailures && !uniqueResult) return null;

  const failed = !!mutationFailures && mutationFailures.length > 0;

  function dismiss() {
    store.clearVerifyResult();
    store.clearMutationFailures();
    store.clearUniqueResult();
  }

  return (
    <div
      data-el="notice.modsResult"
      data-state={failed ? "failure" : "success"}
      className={className ?? "flex items-center gap-2 border-b border-line bg-surface2 px-3 py-1"}
      style={style}
    >
      <span data-part="message" className="[font-size:var(--t-type-label-size)] text-muted2">
        {verifyResult && (
          <span>
            <span className="font-semibold text-ink">{verifyResult.checked} checked</span>
            <span className="text-muted"> · </span>
            <span className="font-semibold text-warn">{verifyResult.outdated} outdated</span>
            <span className="text-muted"> · </span>
            <span className="font-semibold text-accent">{verifyResult.queued} re-downloading</span>
          </span>
        )}
        {mutationFailures &&
          (failed ? (
            <span className="text-danger">
              {mutationFailures.length} mod{mutationFailures.length === 1 ? "" : "s"} could not be
              removed: {mutationFailures[0][1]}
            </span>
          ) : (
            <span className="text-success">Removed ok</span>
          ))}
        {uniqueResult &&
          (uniqueResult.totalUnique === 0 ? (
            <span className="text-warn">
              No mods are unique to {uniqueResult.server} — every mod it uses is shared with
              another favourite/recent server.
            </span>
          ) : uniqueResult.selected === 0 ? (
            <span className="text-warn">
              {uniqueResult.totalUnique} mod{uniqueResult.totalUnique === 1 ? " is" : "s are"}{" "}
              unique to {uniqueResult.server}, but none are in your subscribed library — nothing
              was selected.
            </span>
          ) : uniqueResult.selected === uniqueResult.totalUnique ? (
            <span>
              <span className="font-semibold text-ink">{uniqueResult.selected}</span> unique mod
              {uniqueResult.selected === 1 ? "" : "s"} for {uniqueResult.server} selected
            </span>
          ) : (
            <span>
              <span className="font-semibold text-ink">{uniqueResult.selected}</span> of{" "}
              {uniqueResult.totalUnique} unique mods for {uniqueResult.server} selected (
              {uniqueResult.totalUnique - uniqueResult.selected} not in your library)
            </span>
          ))}
      </span>
      <button
        type="button"
        data-part="dismiss"
        onClick={dismiss}
        className="ml-auto shrink-0 [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted hover:text-ink"
      >
        DISMISS
      </button>
    </div>
  );
}

export function NoticeModsOutdated({ className, style }: { className?: string; style?: CSSProperties }) {
  const { rows, op, updateAllOutdated } = useModsStore(
    useShallow((s) => ({ rows: s.rows, op: s.op, updateAllOutdated: s.updateAllOutdated })),
  );
  const outdatedCount = visibleRows(rows).filter((r) => r.state === "needs_update").length;
  if (outdatedCount === 0) return null;
  const busy = op?.kind === "update";

  return (
    <div
      data-el="notice.modsOutdated"
      data-state={busy ? "busy" : undefined}
      className={className ?? "flex items-center gap-2 border-b border-warn-line bg-warn-soft px-3 py-1.5 [font-size:var(--t-type-compactBody-size)] font-semibold text-warn"}
      style={style}
    >
      <span data-part="message">
        {outdatedCount} mod{outdatedCount === 1 ? "" : "s"} need{outdatedCount === 1 ? "s" : ""} updating
      </span>
      <button
        type="button"
        data-part="updateAll"
        onClick={() => void updateAllOutdated()}
        disabled={!!op}
        className="ml-auto shrink-0 [border-radius:var(--t-radius-controlCompact)] bg-warn px-2 py-1 [font-size:var(--t-type-caption-size)] font-bold uppercase tracking-wider [color:var(--t-color-onAccent)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? op?.note ?? "Updating…" : "Update all"}
      </button>
    </div>
  );
}

type ActionNoticeContent =
  | { kind: "code"; code: string; message: string; detail: string; state: "warning" | "error" }
  | { kind: "plain"; message: string; state: "warning" | "success" }
  | { kind: "refusal"; title: string; message: string; state: "error" };

function resolveActionNoticeContent(
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
    return { kind: "plain", message: notice.text, state: "warning" };
  }

  if (result && result.addr === addr && (result.message || result.error)) {
    if (result.error) {
      return { kind: "refusal", title: "Launch refused", message: result.error, state: "error" };
    }
    return { kind: "plain", message: result.message!, state: "success" };
  }

  return null;
}

export function ServerActionNotice({ className, style }: { className?: string; style?: CSSProperties }) {
  const { subjectContext, selectedServer, contextName } = useElementContext();
  const storeNotice = useLaunchStore((s) => s.notice);
  const result = useLaunchStore((s) => s.result);
  const server = (subjectContext?.kind === "server" ? subjectContext.data : selectedServer) as import("@/types/server").Server | null;
  if (!server) return null;

  const content = resolveActionNoticeContent(server.addr, storeNotice, result);
  if (!content) return null;

  const stateClass =
    content.state === "error" ? "text-danger" : content.state === "success" ? "text-success" : "text-warn";
  const borderClass =
    content.state === "error"
      ? "border-danger/70"
      : content.state === "success"
        ? "border-success/70"
        : "border-warn/70";

  const leading =
    content.kind === "code" ? (
      <span
        data-part="code"
        title={content.detail}
        className={cn(
          "shrink-0 [border-radius:var(--t-radius-controlSmall)] px-1 font-mono-data text-[9px] font-semibold uppercase",
          stateClass,
          content.state === "error" ? "bg-danger/15" : "bg-warn/15",
        )}
      >
        {content.code}
      </span>
    ) : content.kind === "refusal" ? (
      <span data-part="title" className={cn("shrink-0 font-bold uppercase tracking-wider", stateClass)}>
        {content.title}
      </span>
    ) : null;

  // In a row, the notice sits on the row's single line — no border/padding/margin.
  if (contextName === "row") {
    return (
      <div
        data-el="server.actionNotice"
        data-state={content.kind === "refusal" ? "error refused" : content.state}
        className={cn(
          "flex min-w-0 items-center gap-[var(--t-space-inlineGapWide)] [font-size:var(--t-type-label-size)]",
          className,
        )}
        style={style}
      >
        {leading}
        <span data-part="message" className="truncate text-muted2">
          {content.message}
        </span>
      </div>
    );
  }

  return (
    <div
      data-el="server.actionNotice"
      data-state={content.kind === "refusal" ? "error refused" : content.state}
      className={cn("border bg-surface2/60 p-3 my-2", borderClass, className)}
      style={style}
    >
      {leading && <div className="mb-1">{leading}</div>}
      <div data-part="message" className="text-xs text-muted2">
        {content.message}
      </div>
    </div>
  );
}
