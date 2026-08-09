import { useEffect } from "react";
import { X, Download, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { open as openLink } from "@tauri-apps/plugin-shell";
import { useUpdateStore } from "@/stores/update-store";

/** Where the "View Release" link sends a portable user for a manual download. */
const RELEASES_URL = "https://github.com/HellboundGlory/dayz-launcher/releases/latest";

interface UpdateModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The one home for updates, opened from the title-bar badge or the startup
 * banner — no longer buried inside Settings.
 *
 * Installed copies update in place (download → restart); portable copies never
 * auto-modify the running exe, so they get a link to the GitHub release instead.
 */
export function UpdateModal({ open, onClose }: UpdateModalProps) {
  const available = useUpdateStore((s) => s.available);
  const changelog = useUpdateStore((s) => s.changelog);
  const installed = useUpdateStore((s) => s.installed);
  const error = useUpdateStore((s) => s.error);
  const installing = useUpdateStore((s) => s.installing);
  const progress = useUpdateStore((s) => s.progress);
  const install = useUpdateStore((s) => s.install);

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
        role="dialog"
        aria-modal="true"
        aria-label="Update"
        className="flex max-h-[82vh] w-[560px] flex-col overflow-hidden rounded-xl border border-[#1e293b] bg-[#111823] shadow-2xl shadow-black/50"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#1e293b] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[#f1f5f9]">
            {available ? "Update available" : "Updates"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close update dialog"
            className="rounded-md p-1 text-[#64748b] transition-colors duration-150 hover:bg-[#16202e] hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#38bdf8]"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {available ? (
            <>
              <p className="text-xs text-[#94a3b8]">
                A newer version of Tetra Launcher is available.
              </p>
              <p className="mt-1 text-sm font-semibold text-[#f1f5f9]">
                v{available.version}
                {available.date && (
                  <span className="ml-2 text-[10px] font-normal text-[#64748b]">
                    {available.date}
                  </span>
                )}
              </p>

              {available.body || changelog ? (
                <div className="update-changelog mt-3">
                  <ReactMarkdown>{available.body || changelog}</ReactMarkdown>
                </div>
              ) : (
                <p className="mt-3 text-[10px] text-[#64748b]">
                  No changelog notes for this release. See the GitHub release for full notes.
                </p>
              )}

              {progress && installing && (
                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[#38bdf8]">
                  {progress.total
                    ? `Downloading… ${Math.round((progress.downloaded / progress.total) * 100)}%`
                    : "Downloading…"}
                </p>
              )}
              {error && <p className="mt-3 text-[10px] text-[#ef4444]">{error}</p>}
              {/* Portable copy: explain why there's no in-place button. The
                  Install & Restart would replace the installed copy in Program
                  Files, not this portable exe. */}
              {installed !== true && (
                <p className="mt-3 text-[10px] leading-relaxed text-[#64748b]">
                  This is a portable copy, so it can't update itself in place.
                  Grab the latest installer from the GitHub release below.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-[#94a3b8]">You're up to date.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#1e293b] px-5 py-3">
          <button
            onClick={onClose}
            disabled={installing}
            className="rounded-md bg-[#16202e] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] transition-colors duration-150 hover:text-[#f1f5f9] disabled:opacity-50"
          >
            {installing ? "Updating…" : "Later"}
          </button>

          {installed === true ? (
            <button
              onClick={() => void install()}
              disabled={installing}
              className="flex items-center gap-1.5 rounded-md bg-[#38bdf8] px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0b0f17] transition-colors duration-150 hover:bg-[#7dd3fc] disabled:opacity-50"
            >
              <Download className="size-3" />
              Update &amp; Restart
            </button>
          ) : (
            <button
              onClick={() => void openLink(RELEASES_URL)}
              className="flex items-center gap-1.5 rounded-md bg-[#16202e] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] transition-colors duration-150 hover:text-[#f1f5f9]"
            >
              <ExternalLink className="size-3" />
              View Release
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
