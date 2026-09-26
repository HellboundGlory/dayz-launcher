import { useEffect, useState } from "react";
import { Gamepad2, AppWindow, Palette, ChevronLeft, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { discoverSteamPaths, dataFolderPath, openDataFolder } from "@/lib/tauri";
import { SettingsAccordion } from "./settings-accordion";
import { ThemesSection } from "./themes-page/ThemesSection";
import { type SecId, SECS, REFRESH_INTERVALS, INPUT_CLASS, BUTTON_CLASS, Field, CheckboxRow } from "./settings-controls";

// Full-page overlay; the sidebar stays interactive. Four accordions, one open at a time.
export function SettingsView({
  onClose,
  devMode,
  onDevModeChange,
}: {
  onClose: () => void;
  devMode: boolean;
  onDevModeChange: (on: boolean) => void;
}) {
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const workshopPath = useSettingsStore((s) => s.workshopPath);
  const launchParams = useSettingsStore((s) => s.launchParams);
  const closeToTray = useSettingsStore((s) => s.closeToTray);
  const minimiseToTray = useSettingsStore((s) => s.minimiseToTray);
  const startWithWindows = useSettingsStore((s) => s.startWithWindows);
  const startMinimised = useSettingsStore((s) => s.startMinimised);
  const onJoin = useSettingsStore((s) => s.onJoin);
  const autoRefreshIntervalSecs = useSettingsStore((s) => s.autoRefreshIntervalSecs);
  const discordRichPresence = useSettingsStore((s) => s.discordRichPresence);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const [openSec, setOpenSec] = useState<SecId | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [dataFolder, setDataFolder] = useState<string | null>(null);

  // Fixed for the life of the process — the data root is resolved once at
  // startup — so this is fetched once per page mount.
  useEffect(() => {
    dataFolderPath()
      .then(setDataFolder)
      .catch(() => {});
  }, []);

  // Escape closes, matching the old modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(id: SecId) {
    setOpenSec((cur) => (cur === id ? null : id));
  }

  /** Arrow-key roving across the accordion headers; Home/End jump to the ends. */
  function rove(e: React.KeyboardEvent, index: number) {
    const headers = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-acc-header]"),
    );
    if (headers.length === 0) return;
    let next = index;
    if (e.key === "ArrowDown") next = (index + 1) % headers.length;
    else if (e.key === "ArrowUp") next = (index - 1 + headers.length) % headers.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = headers.length - 1;
    else return;
    e.preventDefault();
    headers[next]?.focus();
  }

  async function detectPaths() {
    setDetecting(true);
    try {
      const paths = await discoverSteamPaths();
      if (paths) {
        setSetting("steamPath", paths.steam_install);
        setSetting("dayzPath", paths.dayz_install);
        setSetting("workshopPath", paths.workshop_dir);
      }
    } catch {
      // ignore
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div
      className="settings absolute bottom-0 right-0 top-7 left-[var(--side-w,176px)] z-40 flex flex-col bg-bg transition-[left] [transition-duration:var(--t-motion-expand-duration)]"
    >
      <div
        className="s-head flex shrink-0 items-center justify-between border-b border-line bg-surface px-[18px] py-[13px]"
      >
        <div className="lt flex items-center gap-2.5">
          <button
            data-tetra-el="backAction"
            onClick={onClose}
            aria-label="Back to the launcher"
            className="s-back flex items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-1.5 [font-size:var(--t-type-label-size)] font-semibold text-muted2 transition-colors hover:border-accent-line hover:text-ink"
          >
            <ChevronLeft className="h-3 w-3" />
            Back
          </button>
          <h2 className="m-0 text-sm font-bold text-ink">Settings</h2>
        </div>
      </div>

      <div className="s-body min-h-0 flex-1 overflow-y-auto px-[22px] pb-6 pt-[18px]">
        <SettingsAccordion
          id="game"
          icon={<Gamepad2 className="h-[17px] w-[17px]" />}
          title={SECS[0].title}
          description={SECS[0].description}
          open={openSec === "game"}
          onToggle={() => toggle("game")}
          onKeyDown={(e) => rove(e, 0)}
          tetraToggleEl="sectionToggle"
        >
          <div>
            <Field label="In-Game Name" hint={'Sets -name= at launch, so you are not "Survivor".'}>
              <input
                data-tetra-el="profileNameInput"
                type="text"
                value={profileName}
                onChange={(e) => setSetting("profileName", e.target.value)}
                placeholder="Set your DayZ profile name"
                className={INPUT_CLASS}
              />
            </Field>

            <Field
              label="DayZ Install Path"
              hint="Manual override, for when Steam registry detection fails."
            >
              <div className="flex gap-2">
                <input
                  data-tetra-el="dayzPathInput"
                  type="text"
                  value={dayzPath ?? ""}
                  onChange={(e) => setSetting("dayzPath", e.target.value || null)}
                  placeholder="C:\Program Files (x86)\Steam\steamapps\common\DayZ"
                  className={INPUT_CLASS}
                />
                <button
                  data-tetra-el="detectPathsAction"
                  onClick={detectPaths}
                  disabled={detecting}
                  className={BUTTON_CLASS}
                >
                  <Folder className="size-3" />
                  {detecting ? "…" : "Detect"}
                </button>
              </div>
            </Field>

            {/* Always rendered, so the accordion does not jump the first time a
                path is detected. */}
            <Field label="Workshop Content" hint="Detected from Steam. Read-only.">
              <input
                data-tetra-el="workshopPathInput"
                type="text"
                value={workshopPath ?? ""}
                readOnly
                placeholder="Not detected yet"
                className={cn(INPUT_CLASS, "cursor-default text-muted2")}
              />
            </Field>

            <Field
              label="Custom Launch Parameters"
              hint="Passed to DayZ ahead of the mod list. One per line — e.g. -noPause and -profiles=C:\My Documents\DayZ each on their own line."
            >
              {/* One parameter per line, not space-joined — unambiguous
                  without a shell-quoting parser (a path can contain spaces). */}
              <textarea
                data-tetra-el="launchParamsInput"
                value={launchParams.join("\n")}
                onChange={(e) =>
                  setSetting(
                    "launchParams",
                    e.target.value.split("\n").map((p) => p.trim()).filter(Boolean),
                  )
                }
                placeholder={"-noPause\n-cpuCount=4"}
                spellCheck={false}
                rows={3}
                className={cn(INPUT_CLASS, "resize-y font-mono [font-size:var(--t-type-body-size)]")}
              />
            </Field>
          </div>
        </SettingsAccordion>

        <SettingsAccordion
          id="launcher"
          icon={<AppWindow className="h-[17px] w-[17px]" />}
          title={SECS[1].title}
          description={SECS[1].description}
          open={openSec === "launcher"}
          onToggle={() => toggle("launcher")}
          onKeyDown={(e) => rove(e, 1)}
          tetraToggleEl="sectionToggle"
        >
          <div>
            <div data-tetra-el="windowOptions">
              <h3 className="mb-1 text-xs font-medium text-ink">Window</h3>
              {/* Two independent switches, not one list. Each names the button it
                  changes — the question is never "tray or taskbar?" in the
                  abstract, it is "what should *this* button do?". */}
              <CheckboxRow
                checked={minimiseToTray}
                onChange={(v) => setSetting("minimiseToTray", v)}
                label="Minimise to the system tray"
                hint="The minimise button hides the launcher instead of leaving it on the taskbar."
              />
              <CheckboxRow
                checked={closeToTray}
                onChange={(v) => setSetting("closeToTray", v)}
                label="Close to the system tray"
                hint="The close button hides the launcher instead of quitting. Quit from the tray icon's menu."
              />
            </div>

            <div data-tetra-el="onJoinBehavior" className="mt-2 border-t border-line pt-3">
              <Field
                label="When you join a server"
                hint="DayZ takes a few seconds to appear, so the launcher waits before getting out of the way."
              >
                <select
                  value={onJoin}
                  onChange={(e) => setSetting("onJoin", e.target.value as typeof onJoin)}
                  className={cn(INPUT_CLASS, "cursor-pointer")}
                >
                  <option value="stay">Leave the launcher open</option>
                  <option value="tray">Hide the launcher to the tray</option>
                  <option value="close">Close the launcher</option>
                </select>
              </Field>
            </div>

            <div data-tetra-el="startupOptions" className="mt-2 border-t border-line pt-3">
              <h3 className="mb-1 text-xs font-medium text-ink">Startup</h3>
              <CheckboxRow
                checked={startWithWindows}
                onChange={(v) => setSetting("startWithWindows", v)}
                label="Start with Windows"
                hint="Runs the launcher when you sign in."
              />
              {/* Meaningless on its own: nobody opens an app by hand in order for
                  it not to appear. Disabled rather than hidden so the dependency
                  is visible instead of the row vanishing. */}
              <div className={cn(!startWithWindows && "opacity-40")}>
                <label
                  className={cn(
                    "flex items-start gap-2 py-1",
                    startWithWindows ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={startMinimised}
                    disabled={!startWithWindows}
                    onChange={(e) => setSetting("startMinimised", e.target.checked)}
                    className="mt-0.5 size-3.5 shrink-0 accent-accent disabled:cursor-not-allowed"
                  />
                  <span>
                    <span className="block [font-size:var(--t-type-body-size)] text-ink">Start minimised</span>
                    <span className="mt-0.5 block [font-size:var(--t-type-caption-size)] leading-[1.4] text-muted">
                      Start hidden in the tray. Opening the launcher yourself always shows the window.
                    </span>
                  </span>
                </label>
              </div>
              <p className="mt-1.5 [font-size:var(--t-type-label-size)] leading-relaxed text-muted">
                Start with Windows does nothing in a debug build — the entry would point at the
                build folder and replace your installed copy&apos;s.
              </p>
            </div>

            <div data-tetra-el="discordOption" className="mt-2 border-t border-line pt-3">
              <h3 className="mb-1 text-xs font-medium text-ink">Discord</h3>
              <CheckboxRow
                checked={discordRichPresence}
                onChange={(v) => setSetting("discordRichPresence", v)}
                label="Show Rich Presence in Discord"
                hint="Shows a server you're playing on (or 'Browsing servers') on your Discord profile. Off means the launcher never talks to Discord at all."
              />
            </div>

            <div data-tetra-el="dataFolderControl" className="mt-2 border-t border-line pt-3">
              <Field
                label="Data folder"
                hint="Your favourites, server list and settings. Back this folder up to keep them; deleting it resets the launcher."
              >
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={dataFolder ?? "Locating…"}
                    // Selectable so the path can be copied, but not a control
                    // that pretends to be editable.
                    onFocus={(e) => e.currentTarget.select()}
                    className={cn(INPUT_CLASS, "cursor-text font-mono [font-size:var(--t-type-label-size)]")}
                  />
                  <button
                    onClick={() => void openDataFolder()}
                    disabled={!dataFolder}
                    className={BUTTON_CLASS}
                  >
                    <Folder className="size-3" />
                    Open
                  </button>
                </div>
              </Field>
            </div>

            <div data-tetra-el="autoRefreshControl" className="mt-2 border-t border-line pt-3">
              <Field
                label="Auto-refresh"
                hint="Re-queries the servers on screen, not the whole list. Defaults to a minute — ping is measured from your connection, so rows get their numbers shortly after every load."
              >
                <select
                  value={autoRefreshIntervalSecs}
                  onChange={(e) => setSetting("autoRefreshIntervalSecs", Number(e.target.value))}
                  className={cn(INPUT_CLASS, "cursor-pointer")}
                >
                  {REFRESH_INTERVALS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </SettingsAccordion>

        <SettingsAccordion
          id="theme"
          icon={<Palette className="h-[17px] w-[17px]" />}
          title={SECS[2].title}
          description={SECS[2].description}
          open={openSec === "theme"}
          onToggle={() => toggle("theme")}
          onKeyDown={(e) => rove(e, 2)}
          tetraToggleEl="sectionToggle"
        >
          <div>
            <div data-tetra-el="themeManagement">
              <ThemesSection devMode={devMode} onDevModeChange={onDevModeChange} />
            </div>
          </div>
        </SettingsAccordion>
      </div>
    </div>
  );
}
