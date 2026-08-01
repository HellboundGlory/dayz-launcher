import { useState } from "react";
import { X, Folder } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { discoverSteamPaths } from "@/lib/tauri";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const settings = useSettingsStore();
  const [detecting, setDetecting] = useState(false);

  if (!open) return null;

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