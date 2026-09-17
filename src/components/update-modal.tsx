import { useEffect } from "react";
import { SlotChild } from "@/theme/slot-render";
import { X, Download, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { open as openLink } from "@tauri-apps/plugin-shell";
import { useUpdateStore } from "@/stores/update-store";
import { useComponentComposition } from "@/theme/use-component-composition";
import { ComponentTreeRenderer } from "@/theme/component-tree-renderer";
import { useThemeStore } from "@/theme/theme-store";

/** Where the "View Release" link sends a portable user for a manual download —
    the project's own download page, not a raw link into GitHub's releases list. */
const DOWNLOAD_URL = "https://tetralauncher.com/download";

interface UpdateModalProps {
  open: boolean;
  onClose: () => void;
}

// Installed copies update in place; portable copies get a link to the
// GitHub release instead, since they never auto-modify the running exe.
export function UpdateModal({ open, onClose }: UpdateModalProps) {
  const available = useUpdateStore((s) => s.available);
  const changelog = useUpdateStore((s) => s.changelog);
  const installed = useUpdateStore((s) => s.installed);

  const error = useUpdateStore((s) => s.error);
  const installing = useUpdateStore((s) => s.installing);
  const progress = useUpdateStore((s) => s.progress);
  const install = useUpdateStore((s) => s.install);

  const activeId = useThemeStore((s) => s.activeId);
  const composition = useComponentComposition("modal.update");

  // Escape closes. Bound only while open, so a closed modal keeps no
  // document-level listener alive — the same rule the other popovers use.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-tetra-slot="modal.update"
        role="dialog"
        aria-modal="true"
        aria-label="Update"
        className="relative flex max-h-[82vh] w-[560px] flex-col overflow-hidden [border-radius:var(--t-radius-modalLarge)] border border-line bg-surface [box-shadow:var(--t-shadow-update)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">
            {available ? "Update available" : "Updates"}
          </h2>
          {composition === null && closeAction()}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {available ? (
            <>
              <p className="text-xs text-muted2">
                A newer version of Tetra Launcher is available.
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">
                v{available.version}
                {available.date && (
                  <span className="ml-2 [font-size:var(--t-type-label-size)] font-normal text-muted">
                    {available.date}
                  </span>
                )}
              </p>

              {available.body || changelog ? (
                <div className="update-changelog mt-3">
                  {/* A plain <a> would navigate this webview away with no way back. */}
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <button
                          type="button"
                          onClick={() => href && void openLink(href)}
                          className="text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
                        >
                          {children}
                        </button>
                      ),
                    }}
                  >
                    {available.body || changelog}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="mt-3 [font-size:var(--t-type-label-size)] text-muted">
                  No changelog notes for this release. See the GitHub release for full notes.
                </p>
              )}

              {progress && installing && (
                <p className="mt-3 [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-accent">
                  {progress.total
                    ? `Downloading… ${Math.round((progress.downloaded / progress.total) * 100)}%`
                    : "Downloading…"}
                </p>
              )}
              {error && <p className="mt-3 [font-size:var(--t-type-label-size)] text-danger">{error}</p>}
              {/* Portable copy: explain why there's no in-place button. The
                  Install & Restart would replace the installed copy in Program
                  Files, not this portable exe. */}
              {installed !== true && (
                <p className="mt-3 [font-size:var(--t-type-label-size)] leading-relaxed text-muted">
                  This is a portable copy, so it can't update itself in place.
                  Grab the latest installer from the GitHub release below.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted2">You're up to date.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
          {composition === null && laterAction()}
          {composition === null &&
            (installed === true ? (
              <SlotChild slotId="modal.update" id="installAction">
                {installAction()}
              </SlotChild>
            ) : (
              <SlotChild slotId="modal.update" id="viewReleaseAction">
                {viewReleaseAction()}
              </SlotChild>
            ))}
        </div>
        {composition !== null && (
          // The overlay is pointer-events-none so clicks reach the version,
          // changelog and progress beneath wherever the composition doesn't
          // cover them; each themed child re-enables its own.
          <div className="pointer-events-none absolute inset-0">
            <ComponentTreeRenderer
              node={composition}
              nodes={{
                closeAction: <div className="pointer-events-auto">{closeAction()}</div>,
                laterAction: <div className="pointer-events-auto">{laterAction()}</div>,
                ...(installed === true
                  ? { installAction: <div className="pointer-events-auto">{installAction()}</div> }
                  : { viewReleaseAction: <div className="pointer-events-auto">{viewReleaseAction()}</div> }),
              }}
              themeId={activeId}
            />
          </div>
        )}
      </div>
    </div>
  );

  function closeAction(): React.ReactNode {
    return (
      <button
        data-tetra-el="closeAction"
        onClick={onClose}
        aria-label="Close update dialog"
        className="[border-radius:var(--t-radius-control)] p-1 text-muted transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:bg-surface2 hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <X className="size-4" />
      </button>
    );
  }

  function laterAction(): React.ReactNode {
    return (
      <button
        data-tetra-el="laterAction"
        onClick={onClose}
        disabled={installing}
        className="[border-radius:var(--t-radius-control)] bg-surface2 px-4 py-1.5 [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 ring-1 ring-line transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:text-ink disabled:opacity-50"
      >
        {installing ? "Updating…" : "Later"}
      </button>
    );
  }

  function installAction(): React.ReactNode {
    return (
      <button
        data-tetra-el="installAction"
        onClick={() => void install()}
        disabled={installing}
        className="flex items-center gap-1.5 [border-radius:var(--t-radius-control)] bg-accent px-4 py-1.5 [font-size:var(--t-type-label-size)] font-bold uppercase tracking-wider text-bg transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:brightness-110 disabled:opacity-50"
      >
        <Download className="size-3" />
        Update &amp; Restart
      </button>
    );
  }

  function viewReleaseAction(): React.ReactNode {
    return (
      <button
        data-tetra-el="viewReleaseAction"
        onClick={() => void openLink(DOWNLOAD_URL)}
        className="flex items-center gap-1.5 [border-radius:var(--t-radius-control)] bg-surface2 px-4 py-1.5 [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 ring-1 ring-line transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:text-ink"
      >
        <ExternalLink className="size-3" />
        View Release
      </button>
    );
  }
}
