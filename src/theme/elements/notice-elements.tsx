import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useElementContext } from "./context";

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
      <span data-part="label" className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-warn">
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
      <span data-part="label" className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-danger">
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
      <span data-part="label" className="[font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-accent">
        Update available
      </span>
      <span data-part="message" className="min-w-0 flex-1 truncate [font-size:var(--t-type-body-size)] text-ink">
        Tetra Launcher v{updateAvailable.version} is ready to install.
      </span>
      <button
        type="button"
        data-part="action"
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
        data-part="dismiss"
        onClick={dismissUpdateBanner}
        className="shrink-0 [border-radius:var(--t-radius-controlSmall)] px-[var(--t-space-controlCompactX)] py-[var(--t-space-controlSmallY)] [font-size:var(--t-type-label-size)] uppercase text-muted hover:text-ink"
      >
        Later
      </button>
    </div>
  );
}

export function NoticeModsError({ className, style }: { className?: string; style?: CSSProperties }) {
  const { error } = useElementContext();
  if (!error) return null;
  return (
    <div data-el="notice.modsError" role="alert" className={className} style={style}>
      <span data-part="label">MODS ERROR</span>
      <span data-part="message">{error}</span>
    </div>
  );
}

export function NoticeModsCached(props?: { className?: string; style?: CSSProperties }) {
  if (props === undefined) return null;
  return null;
}

export function NoticeModsResult(props?: { className?: string; style?: CSSProperties }) {
  if (props === undefined) return null;
  return null;
}

export function NoticeModsOutdated(props?: { className?: string; style?: CSSProperties }) {
  if (props === undefined) return null;
  return null;
}

export function ServerActionNotice({ className, style }: { className?: string; style?: CSSProperties }) {
  const { subjectContext, selectedServer, contextName } = useElementContext();
  const server = (subjectContext?.kind === "server" ? subjectContext.data : selectedServer) as import("@/types/server").Server | null;
  if (!server || !server.modded) return null;

  // In a row, the notice sits on the row's single line — no border/padding/margin.
  if (contextName === "row") {
    return (
      <div
        data-el="server.actionNotice"
        className={cn(
          "flex min-w-0 items-center gap-[var(--t-space-inlineGapWide)] [font-size:var(--t-type-label-size)]",
          className,
        )}
        style={style}
      >
        <span data-part="title" className="shrink-0 font-bold uppercase tracking-wider text-warn">
          2 MODS NEED UPDATING
        </span>
        <span data-part="message" className="truncate text-muted2">
          1 not subscribed · 1.6 GB to download before you can join
        </span>
      </div>
    );
  }

  return (
    <div
      data-el="server.actionNotice"
      className={cn(
        "border border-warn/70 bg-surface2/60 p-3 my-2",
        className,
      )}
      style={style}
    >
      <div data-part="title" className="text-warn font-bold text-xs uppercase tracking-wider">
        2 MODS NEED UPDATING
      </div>
      <div data-part="message" className="text-xs text-muted2 mt-1">
        1 not subscribed · 1.6 GB to download before you can join
      </div>
    </div>
  );
}
