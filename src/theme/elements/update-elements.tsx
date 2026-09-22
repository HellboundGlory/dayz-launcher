import type { CSSProperties, MouseEvent } from "react";
import { open as openLink } from "@tauri-apps/plugin-shell";
import { useUpdateStore } from "@/stores/update-store";
import { DOWNLOAD_URL, UpdateChangelogMarkdown } from "@/components/update-modal";
import { useElementContext } from "./context";

function joinStates(...states: (string | false | null | undefined)[]): string | undefined {
  const active = states.filter(Boolean) as string[];
  return active.length > 0 ? active.join(" ") : undefined;
}

export function UpdateInstall({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const installed = useUpdateStore((s) => s.installed);
  const installing = useUpdateStore((s) => s.installing);
  const install = useUpdateStore((s) => s.install);
  if (installed !== true) return null;

  return (
    <button
      type="button"
      data-el="update.install"
      data-state={joinStates(installing && "busy", installing && "disabled")}
      disabled={installing}
      onClick={() => void install()}
      className={className}
      style={style}
    >
      <span data-part="label">Update &amp; Restart</span>
    </button>
  );
}

export function UpdateViewRelease({
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const installed = useUpdateStore((s) => s.installed);
  if (installed === true) return null;

  return (
    <button
      type="button"
      data-el="update.viewRelease"
      onClick={() => void openLink(DOWNLOAD_URL)}
      className={className}
      style={style}
    >
      <span data-part="label">View Release</span>
    </button>
  );
}

export function UpdateLater({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const installing = useUpdateStore((s) => s.installing);
  const { closeModal } = useElementContext();
  const baseLabel = (options?.label as string) ?? "Later";

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    closeModal();
  };

  return (
    <button
      type="button"
      data-el="update.later"
      data-state={joinStates(installing && "disabled")}
      disabled={installing}
      onClick={handleClick}
      className={className}
      style={style}
    >
      <span data-part="label">{installing ? "Updating…" : baseLabel}</span>
    </button>
  );
}

export function UpdateTitle({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const available = useUpdateStore((s) => s.available);
  return (
    <span data-el="update.title" className={className} style={style}>
      <span data-part="text">{available ? "Update available" : "Updates"}</span>
    </span>
  );
}

export function UpdateSummary({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const available = useUpdateStore((s) => s.available);

  if (!available) {
    return (
      <div data-el="update.summary" data-state="upToDate" className={className} style={style}>
        <span data-part="message">You're up to date.</span>
      </div>
    );
  }

  return (
    <div data-el="update.summary" data-state="available" className={className} style={style}>
      <span data-part="message">A newer version of Tetra Launcher is available.</span>
      <span data-part="version">v{available.version}</span>
      {available.date && <span data-part="date">{available.date}</span>}
    </div>
  );
}

export function UpdateChangelog({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const available = useUpdateStore((s) => s.available);
  const changelog = useUpdateStore((s) => s.changelog);
  const content = available?.body || changelog;

  if (!content) {
    return (
      <div data-el="update.changelog" data-state="empty" className={className} style={style}>
        <span data-part="content">
          No changelog notes for this release. See the GitHub release for full notes.
        </span>
      </div>
    );
  }

  return (
    <div data-el="update.changelog" className={className} style={style}>
      <div data-part="content">
        <UpdateChangelogMarkdown content={content} />
      </div>
    </div>
  );
}

export function UpdateProgress({
  options,
  className,
  style,
}: {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}) {
  const installing = useUpdateStore((s) => s.installing);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);

  if (!error && !(progress && installing)) return null;

  const baseLabel = (options?.label as string) ?? "Downloading…";
  const pct = progress?.total ? Math.round((progress.downloaded / progress.total) * 100) : null;
  const label = pct !== null ? `${baseLabel} ${pct}%` : baseLabel;

  return (
    <div
      data-el="update.progress"
      data-state={joinStates(progress && installing && "downloading", error && "failed")}
      className={className}
      style={style}
    >
      {progress && installing && (
        <>
          <span data-part="label">{label}</span>
          <span data-part="bar" style={{ width: pct !== null ? `${pct}%` : undefined }} />
        </>
      )}
      {error && <span data-part="error">{error}</span>}
    </div>
  );
}

export function UpdatePortableNote({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const installed = useUpdateStore((s) => s.installed);
  if (installed === true) return null;

  return (
    <span data-el="update.portableNote" className={className} style={style}>
      <span data-part="text">
        This is a portable copy, so it can't update itself in place. Grab the latest installer
        from the GitHub release below.
      </span>
    </span>
  );
}
