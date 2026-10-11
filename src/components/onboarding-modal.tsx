import { useEffect, useState } from "react";
import {
  ArrowRight,
  CircleCheck,
  Folder,
  FolderOpen,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { discoverSteamPaths, validateDayzPath } from "@/lib/tauri";
import tetraLogo from "@/assets/tetra-logo.png";

type ScanPhase = "scanning" | "found" | "not-found";

const INPUT_BASE_CLASS =
  "w-full [border-radius:var(--t-radius-control)] border border-line bg-bg px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] text-ink placeholder-muted outline-hidden transition-colors duration-150 hover:border-line-weak focus:border-accent-line";

const GHOST_BUTTON_CLASS =
  "flex shrink-0 items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-compactCaption-size)] font-bold uppercase tracking-wider text-muted2 transition-colors duration-150 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";

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
    <div className="absolute inset-0 z-[var(--z-onboarding)] flex items-center justify-center [background-color:var(--t-color-scrim)]">
      <div
        className="w-[min(360px,calc(100%-40px))] overflow-hidden [border-radius:var(--t-radius-modal)] border border-line bg-surface [box-shadow:var(--t-shadow-modal)]"
      >
        <div className="flex items-start gap-2.5 border-b border-line p-4">
          <img src={tetraLogo} alt="" className="size-9 shrink-0 rounded-[7px] [box-shadow:var(--t-glow-rest)]" />
          <div>
            <h2 className="[font-size:var(--t-type-compactHeading-size)] font-bold text-ink">Set up your survivor</h2>
            <p className="mt-0.5 [font-size:var(--t-type-compactBody-size)] leading-relaxed text-muted">
              One-time setup — who you are, and where DayZ lives.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3.5 p-4">
          <div>
            <label className="mb-1.5 block [font-size:var(--t-type-compactCaption-size)] font-bold uppercase tracking-wider text-muted2">
              Survivor name
            </label>
            <input
              type="text"
              value={profileName}
              onChange={(e) => setSetting("profileName", e.target.value)}
              placeholder="e.g. Survivor"
              autoFocus
              className={cn(INPUT_BASE_CLASS, "[font-size:var(--t-type-compactSubheading-size)]")}
            />
            <p className="mt-1 [font-size:var(--t-type-compactCaption-size)] leading-relaxed text-muted">
              Sets <span className="font-mono-data">-name=</span> at launch, so you&apos;re not
              &quot;Survivor&quot;.
            </p>
          </div>

          {phase === "scanning" && (
            <div className="flex items-center gap-1.5 rounded-[7px] bg-accent-soft px-2.5 py-2 [font-size:var(--t-type-compactBody-size)] leading-relaxed text-accent">
              <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
              <span>Scanning your Steam library for DayZ…</span>
            </div>
          )}

          {phase === "found" && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 [font-size:var(--t-type-compactCaption-size)] font-bold uppercase tracking-wider text-muted2">
                DayZ install path
                <span className="inline-flex items-center gap-0.5 [border-radius:var(--t-radius-chip)] bg-success-soft px-1.5 py-px [font-size:var(--t-type-size-2xs)] font-bold uppercase tracking-wide text-success">
                  <CircleCheck className="size-2.5" /> Auto-detected
                </span>
              </label>
              <div className="flex items-center justify-between gap-2 [border-radius:var(--t-radius-control)] border border-line-weak bg-bg px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate font-mono-data [font-size:var(--t-type-size-sm)] text-muted2">
                  {dayzPath}
                </span>
                <button
                  onClick={() => setPhase("not-found")}
                  className="shrink-0 [font-size:var(--t-type-compactCaption-size)] font-bold text-accent underline underline-offset-2"
                >
                  Change
                </button>
              </div>
            </div>
          )}

          {phase === "not-found" && (
            <div>
              <label className="mb-1.5 block [font-size:var(--t-type-compactCaption-size)] font-bold uppercase tracking-wider text-muted2">
                DayZ install path
              </label>
              <div
                className={cn(
                  "mb-1.5 flex items-center gap-1.5 rounded-[7px] px-2.5 py-2 [font-size:var(--t-type-compactBody-size)] leading-relaxed",
                  pathValid
                    ? "bg-success-soft text-success"
                    : "bg-warn-soft text-warn",
                )}
              >
                {pathValid ? (
                  <CircleCheck className="size-3.5 shrink-0" />
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
                  className={cn(INPUT_BASE_CLASS, "font-mono-data [font-size:var(--t-type-size-sm)]")}
                />
                <button
                  data-tetra-el="pathBrowser"
                  onClick={browseForFolder}
                  disabled={browsing}
                  title="Browse for your DayZ install folder"
                  className={GHOST_BUTTON_CLASS}
                >
                  <FolderOpen className="size-3" />
                  Browse
                </button>
                <button
                  onClick={() => void scan()}
                  title="Scan the Steam registry again"
                  className={GHOST_BUTTON_CLASS}
                >
                  <Folder className="size-3" />
                  Retry
                </button>
              </div>
              <p className="mt-1 [font-size:var(--t-type-compactCaption-size)] leading-relaxed text-muted">
                Pick the folder that has <span className="font-mono-data">DayZ_x64.exe</span> in
                it, or paste the path directly.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line p-4 pt-3">
          <button
            data-tetra-el="primaryAction"
            onClick={finish}
            disabled={!canContinue}
            className="flex w-full items-center justify-center gap-1.5 [border-radius:var(--t-radius-control)] bg-accent py-[var(--t-space-controlY)] [font-size:var(--t-type-compactBody-size)] font-bold uppercase tracking-wider [color:var(--t-color-onAccent)] [box-shadow:var(--t-glow-rest)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none disabled:hover:brightness-100"
          >
            <span>Continue</span>
            {canContinue && <ArrowRight className="size-3" />}
          </button>
          {phase !== "scanning" && (
            <button
              onClick={finish}
              className="text-center [font-size:var(--t-type-size-sm)] text-muted transition-colors hover:text-ink"
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
