import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Folder,
  FolderOpen,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { discoverSteamPaths, validateDayzPath } from "@/lib/tauri";
import tetraLogo from "@/assets/tetra-logo.png";

type ScanPhase = "scanning" | "found" | "not-found";

const INPUT_CLASS =
  "w-full rounded-[6px] border border-line bg-bg px-2.5 py-2 text-[11.5px] text-ink placeholder-muted outline-none transition-colors duration-150 hover:border-line-weak focus:border-accent-line";

const GHOST_BUTTON_CLASS =
  "flex shrink-0 items-center gap-1.5 rounded-[6px] border border-line bg-surface2 px-2.5 text-[9.5px] font-bold uppercase tracking-wider text-muted2 transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

// Fires once, on the very first launch: who the player is, and where DayZ
// lives. Runs the same registry scan the Settings "Detect" button does.
export function OnboardingModal({ onDone }: { onDone: () => void }) {
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const flush = useSettingsStore((s) => s.flush);

  const [phase, setPhase] = useState<ScanPhase>("scanning");
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const [browsing, setBrowsing] = useState(false);

  async function scan() {
    setPhase("scanning");
    try {
      const paths = await discoverSteamPaths();
      if (paths) {
        setSetting("steamPath", paths.steam_install);
        setSetting("dayzPath", paths.dayz_install);
        setSetting("workshopPath", paths.workshop_dir);
        setPhase("found");
        return;
      }
    } catch {
      // falls through to not-found
    }
    setPhase("not-found");
  }

  useEffect(() => {
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-checks the manually entered/browsed path once typing settles, so the
  // "not found" state can quietly confirm itself without a Retry click.
  useEffect(() => {
    if (phase !== "not-found" || !dayzPath) {
      setPathValid(null);
      return;
    }
    const t = setTimeout(() => {
      void validateDayzPath(dayzPath).then(setPathValid);
    }, 400);
    return () => clearTimeout(t);
  }, [phase, dayzPath]);

  async function browseForFolder() {
    setBrowsing(true);
    try {
      const selected = await open({
        directory: true,
        title: "Select your DayZ install folder",
      });
      if (typeof selected === "string") {
        setSetting("dayzPath", selected);
        const valid = await validateDayzPath(selected);
        setPathValid(valid);
      }
    } catch {
      // User cancelled the dialog, or the platform has no native picker — ignore.
    } finally {
      setBrowsing(false);
    }
  }

  function finish() {
    setSetting("onboardingDismissed", true);
    void flush();
    onDone();
  }

  const canContinue = phase !== "scanning" && profileName.trim().length > 0;

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[rgba(5,8,13,0.7)]">
      <div className="w-[min(360px,calc(100%-40px))] overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
        <div className="flex items-start gap-2.5 border-b border-line p-4">
          <img src={tetraLogo} alt="" className="size-9 shrink-0 rounded-[7px] shadow-[var(--glow)]" />
          <div>
            <h2 className="text-[13.5px] font-bold text-ink">Set up your survivor</h2>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
              One-time setup — who you are, and where DayZ lives.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3.5 p-4">
          <div>
            <label className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-wider text-muted2">
              Survivor name
            </label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setSetting("profileName", e.target.value)}
              placeholder="e.g. Survivor"
              autoFocus
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-[9.5px] leading-relaxed text-muted">
              Sets <span className="font-mono-data">-name=</span> at launch, so you&apos;re not
              &quot;Survivor&quot;.
            </p>
          </div>

          {phase === "scanning" && (
            <div className="flex items-center gap-1.5 rounded-[7px] bg-accent-soft px-2.5 py-2 text-[10.5px] leading-relaxed text-accent">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span>Scanning your Steam library for DayZ…</span>
            </div>
          )}

          {phase === "found" && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted2">
                DayZ install path
                <span className="inline-flex items-center gap-0.5 rounded-[4px] bg-[rgba(77,154,117,0.16)] px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-success">
                  <CheckCircle2 className="size-2.5" /> Auto-detected
                </span>
              </label>
              <div className="flex items-center justify-between gap-2 rounded-[6px] border border-line-weak bg-bg px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate font-mono-data text-[10px] text-muted2">
                  {dayzPath}
                </span>
                <button
                  onClick={() => setPhase("not-found")}
                  className="shrink-0 text-[9.5px] font-bold text-accent underline underline-offset-2"
                >
                  Change
                </button>
              </div>
            </div>
          )}

          {phase === "not-found" && (
            <div>
              <label className="mb-1.5 block text-[9.5px] font-bold uppercase tracking-wider text-muted2">
                DayZ install path
              </label>
              <div
                className={cn(
                  "mb-1.5 flex items-center gap-1.5 rounded-[7px] px-2.5 py-2 text-[10.5px] leading-relaxed",
                  pathValid
                    ? "bg-[rgba(77,154,117,0.16)] text-success"
                    : "bg-warn-soft text-warn",
                )}
              >
                {pathValid ? (
                  <CheckCircle2 className="size-3.5 shrink-0" />
                ) : (
                  <TriangleAlert className="size-3.5 shrink-0" />
                )}
                <span>
                  {pathValid
                    ? "Found it — DayZ_x64.exe is in that folder."
                    : "Couldn't find it automatically."}
                </span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={dayzPath ?? ""}
                  onChange={(e) => setSetting("dayzPath", e.target.value || null)}
                  placeholder="C:\Program Files (x86)\Steam\steamapps\common\DayZ"
                  className={cn(INPUT_CLASS, "font-mono-data text-[10px]")}
                />
                <button
                  onClick={browseForFolder}
                  disabled={browsing}
                  title="Browse for your DayZ install folder"
                  className={cn(GHOST_BUTTON_CLASS, "py-2")}
                >
                  <FolderOpen className="size-3" />
                  Browse
                </button>
                <button
                  onClick={() => void scan()}
                  title="Scan the Steam registry again"
                  className={cn(GHOST_BUTTON_CLASS, "py-2")}
                >
                  <Folder className="size-3" />
                  Retry
                </button>
              </div>
              <p className="mt-1 text-[9.5px] leading-relaxed text-muted">
                Pick the folder that has <span className="font-mono-data">DayZ_x64.exe</span> in
                it, or paste the path directly.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line p-4 pt-3">
          <button
            onClick={finish}
            disabled={!canContinue}
            className="flex w-full items-center justify-center gap-1.5 rounded-[6px] bg-accent py-2 text-[10.5px] font-bold uppercase tracking-wider text-[#10131a] shadow-[var(--glow)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none disabled:hover:brightness-100"
          >
            <span>Continue</span>
            {canContinue && <ArrowRight className="size-3" />}
          </button>
          {phase !== "scanning" && (
            <button
              onClick={finish}
              className="text-center text-[10px] text-muted transition-colors hover:text-ink"
            >
              {profileName.trim().length > 0 ? (
                "Skip the rest — finish later in Settings"
              ) : (
                <>
                  Not sure?{" "}
                  <span className="font-semibold text-muted2 underline underline-offset-2">
                    Skip — set this up later in Settings
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
