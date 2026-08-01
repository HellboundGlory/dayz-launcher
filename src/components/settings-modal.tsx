import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { X, Folder, RefreshCw, Download, ExternalLink, CheckCircle2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useUpdateStore } from "@/stores/update-store";
import { discoverSteamPaths } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Where the "View Release" link sends a portable user for a manual download. */
const RELEASES_URL = "https://github.com/HellboundGlory/dayz-launcher/releases/latest";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open: isOpen, onClose }: SettingsModalProps) {
  const settings = useSettingsStore();
  const [detecting, setDetecting] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  const {
    installed,
    checking,
    checked,
    available,
    error: updateError,
    installing,
    progress,
    checkNow,
    install,
  } = useUpdateStore();

  useEffect(() => {
    if (!isOpen) return;
    getVersion()
      .then(setCurrentVersion)
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  async function detectPaths() {
    setDetecting(true);
    try {
      const paths = await discoverSteamPaths();
      if (paths) {
        settings.setSetting("steamPath", paths.steam_install);
        settings.setSetting("dayzPath", paths.dayz_install);
        settings.setSetting("workshopPath", paths.workshop_dir);
      }
    } catch {
      // ignore
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div className="w-[480px] rounded-lg border border-[#1e293b] bg-[#111823] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1e293b] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#f1f5f9]">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-[#64748b] hover:bg-[#16202e] hover:text-[#f1f5f9]"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 px-4 py-4">
          {/* Profile Name */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
              In-Game Name
            </label>
            <input
              type="text"
              value={settings.profileName}
              onChange={(e) => settings.setSetting("profileName", e.target.value)}
              placeholder="Set your DayZ profile name"
              className="w-full rounded bg-[#16202e] px-2 py-1.5 text-xs text-[#f1f5f9] placeholder-[#475569] outline-none ring-1 ring-[#1e293b] focus:ring-[#38bdf8]"
            />
            <p className="mt-1 text-[10px] text-[#64748b]">
              Launches DayZ with -name= set so you don't appear as "Survivor"
            </p>
          </div>

          {/* DayZ Install Path */}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
              DayZ Install Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.dayzPath ?? ""}
                onChange={(e) => settings.setSetting("dayzPath", e.target.value || null)}
                placeholder="C:\Program Files (x86)\Steam\steamapps\common\DayZ"
                className="flex-1 rounded bg-[#16202e] px-2 py-1.5 text-xs text-[#f1f5f9] placeholder-[#475569] outline-none ring-1 ring-[#1e293b] focus:ring-[#38bdf8]"
              />
              <button
                onClick={detectPaths}
                disabled={detecting}
                className="flex items-center gap-1 rounded bg-[#16202e] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] ring-1 ring-[#1e293b] hover:text-[#94a3b8] disabled:opacity-50"
              >
                <Folder className="size-3" />
                {detecting ? "..." : "DETECT"}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-[#64748b]">
              Manual override if Steam registry detection fails
            </p>
          </div>

          {/* Auto-join behaviour */}
          <div>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={settings.autoJoinAfterDownload}
                onChange={(e) => settings.setSetting("autoJoinAfterDownload", e.target.checked)}
                className="mt-0.5 size-3.5 shrink-0 accent-[#38bdf8]"
              />
              <span>
                <span className="block text-xs text-[#f1f5f9]">
                  Auto-join after downloading
                </span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-[#64748b]">
                  "Subscribe and join" launches DayZ automatically once every required mod
                  has finished downloading. Turn this off to subscribe and download only,
                  then join manually.
                </span>
              </span>
            </label>
          </div>

          {/* Workshop Path (read-only, auto-detected) */}
          {settings.workshopPath && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
                Workshop Content
              </label>
              <input
                type="text"
                value={settings.workshopPath}
                readOnly
                className="w-full rounded bg-[#0b0f17] px-2 py-1.5 text-xs text-[#475569] outline-none ring-1 ring-[#1e293b]"
              />
            </div>
          )}

          {/* Updates */}
          <div className="border-t border-[#1e293b] pt-4">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#64748b]">
              Updates
            </label>
            <div className="flex items-center justify-between gap-2 rounded bg-[#16202e] px-2 py-1.5 ring-1 ring-[#1e293b]">
              <span className="text-xs text-[#94a3b8]">
                {currentVersion ? `Tetra Launcher v${currentVersion}` : "Tetra Launcher"}
              </span>
              <button
                onClick={() => void checkNow()}
                disabled={checking || installing}
                className="flex items-center gap-1 rounded bg-[#0b0f17] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] ring-1 ring-[#1e293b] hover:text-[#94a3b8] disabled:opacity-50"
              >
                <RefreshCw className={cn("size-3", checking && "animate-spin")} />
                {checking ? "Checking…" : "Check for Updates"}
              </button>
            </div>

            {updateError && (
              <p className="mt-1.5 text-[10px] text-[#ef4444]">{updateError}</p>
            )}

            {available ? (
              <div className="mt-2 rounded bg-[#38bdf8]/5 px-2 py-1.5 ring-1 ring-[#38bdf8]/20">
                <p className="text-xs font-medium text-[#f1f5f9]">
                  v{available.version} is available
                </p>
                {available.body && (
                  <p className="mt-0.5 line-clamp-3 text-[10px] leading-relaxed text-[#94a3b8]">
                    {available.body}
                  </p>
                )}

                {installed === true ? (
                  installing ? (
                    <p className="mt-1.5 text-[10px] text-[#64748b]">
                      {progress?.total
                        ? `Downloading… ${Math.round((progress.downloaded / progress.total) * 100)}%`
                        : "Downloading…"}
                    </p>
                  ) : (
                    <button
                      onClick={() => void install()}
                      className="mt-1.5 flex items-center gap-1 rounded bg-[#38bdf8] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#0b0f17] hover:bg-[#7dd3fc]"
                    >
                      <Download className="size-3" />
                      Install &amp; Restart
                    </button>
                  )
                ) : (
                  // Portable copy: never auto-modifies the running exe — the
                  // installer would land in Program Files, not this folder.
                  <button
                    onClick={() => void open(RELEASES_URL)}
                    className="mt-1.5 flex items-center gap-1 rounded bg-[#16202e] px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#64748b] ring-1 ring-[#1e293b] hover:text-[#94a3b8]"
                  >
                    <ExternalLink className="size-3" />
                    View Release
                  </button>
                )}
              </div>
            ) : (
              checked &&
              !checking &&
              !updateError && (
                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[#64748b]">
                  <CheckCircle2 className="size-3 text-[#22c55e]" />
                  You're up to date
                </p>
              )
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[#1e293b] px-4 py-3">
          <button
            onClick={onClose}
            className="rounded bg-[#38bdf8] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#0b0f17] hover:bg-[#7dd3fc]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}