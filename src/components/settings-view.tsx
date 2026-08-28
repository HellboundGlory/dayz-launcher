import { useEffect, useState } from "react";
import { Gamepad2, AppWindow, Filter, Palette, ChevronLeft, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { discoverSteamPaths, dataFolderPath, openDataFolder } from "@/lib/tauri";
import { SettingsAccordion } from "./settings-accordion";
import { ThemeCustomiser } from "./theme-customiser";

type SecId = "game" | "launcher" | "browser" | "theme";

const SECS: { id: SecId; icon: typeof Gamepad2; title: string; description: string }[] = [
  { id: "game", icon: Gamepad2, title: "Game", description: "DayZ path, launch params, join behaviour" },
  {
    id: "launcher",
    icon: AppWindow,
    title: "Launcher",
    description: "Tray behaviour, startup, Discord presence",
  },
  {
    id: "browser",
    icon: Filter,
    title: "Server Browser",
    description: "Discovery, refresh, filters",
  },
  { id: "theme", icon: Palette, title: "Theme", description: "Palette, bloom, custom skins" },
];

/** The auto-refresh choices, in seconds. `0` is off. */
const REFRESH_INTERVALS: { value: number; label: string }[] = [
  { value: 0, label: "Never" },
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 600, label: "Every 10 minutes" },
];

/** The shared text-input / select styling (board `.field input`). */
const INPUT_CLASS =
  "w-full rounded-[6px] border border-line bg-bg px-2.5 py-2 text-xs text-ink placeholder-muted outline-none transition-colors duration-150 hover:border-line-weak focus:border-accent-line";

/** Small secondary button (Detect / Open) sitting next to an input. */
const BUTTON_CLASS =
  "flex shrink-0 items-center gap-1.5 rounded-[6px] border border-line bg-surface2 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted2 transition-colors duration-150 hover:text-ink disabled:opacity-50";

/**
 * Settings — full-page overlay (A1). The rail stays interactive: the overlay
 * starts at `var(--side-w)` (the sidebar's live width, set by App) and covers
 * the rest. Four accordions, one open at a time; every field the old modal
 * had survives here.
 */
export function SettingsView({ onClose }: { onClose: () => void }) {
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const workshopPath = useSettingsStore((s) => s.workshopPath);
  const autoJoinAfterDownload = useSettingsStore((s) => s.autoJoinAfterDownload);
  const hidePlaceholderServers = useSettingsStore((s) => s.hidePlaceholderServers);
  const englishNamesFilter = useSettingsStore((s) => s.englishNamesFilter);
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
    <div className="settings absolute inset-y-0 right-0 left-[var(--side-w,220px)] z-40 flex flex-col bg-bg transition-[left] duration-200">
      <div className="s-head flex shrink-0 items-center justify-between border-b border-line bg-surface px-[18px] py-[13px]">
        <div className="lt flex items-center gap-2.5">
          <button
            onClick={onClose}
            aria-label="Back to the launcher"
            className="s-back flex items-center gap-1.5 rounded-[6px] border border-line bg-surface2 px-2.5 py-1.5 text-[10px] font-semibold text-muted2 transition-colors hover:border-accent-line hover:text-ink"
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
        >
          <Field label="In-Game Name" hint={'Sets -name= at launch, so you are not "Survivor".'}>
            <input
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
                type="text"
                value={dayzPath ?? ""}
                onChange={(e) => setSetting("dayzPath", e.target.value || null)}
                placeholder="C:\Program Files (x86)\Steam\steamapps\common\DayZ"
                className={INPUT_CLASS}
              />
              <button onClick={detectPaths} disabled={detecting} className={BUTTON_CLASS}>
                <Folder className="size-3" />
                {detecting ? "…" : "Detect"}
              </button>
            </div>
          </Field>

          {/* Always rendered, so the accordion does not jump the first time a
              path is detected. */}
          <Field label="Workshop Content" hint="Detected from Steam. Read-only.">
            <input
              type="text"
              value={workshopPath ?? ""}
              readOnly
              placeholder="Not detected yet"
              className={cn(INPUT_CLASS, "cursor-default text-muted2")}
            />
          </Field>

          <Field
            label="Custom Launch Parameters"
            hint="Passed to DayZ ahead of the mod list. Example: -noPause -cpuCount=4"
          >
            <input
              type="text"
              value={launchParams.join(" ")}
              onChange={(e) =>
                setSetting("launchParams", e.target.value.split(/\s+/).filter(Boolean))
              }
              placeholder="-noPause -cpuCount=4"
              spellCheck={false}
              className={INPUT_CLASS}
            />
          </Field>

          <CheckboxRow
            checked={autoJoinAfterDownload}
            onChange={(v) => setSetting("autoJoinAfterDownload", v)}
            label="Auto-join after downloading"
            hint="Launch automatically once every required mod has finished downloading."
          />
        </SettingsAccordion>

        <SettingsAccordion
          id="launcher"
          icon={<AppWindow className="h-[17px] w-[17px]" />}
          title={SECS[1].title}
          description={SECS[1].description}
          open={openSec === "launcher"}
          onToggle={() => toggle("launcher")}
          onKeyDown={(e) => rove(e, 1)}
        >
          <div>
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

          <div className="mt-2 border-t border-line pt-3">
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

          <div className="mt-2 border-t border-line pt-3">
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
                  <span className="block text-[11px] text-ink">Start minimised</span>
                  <span className="mt-0.5 block text-[9px] leading-[1.4] text-muted">
                    Start hidden in the tray. Opening the launcher yourself always shows the window.
                  </span>
                </span>
              </label>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
              Start with Windows does nothing in a debug build — the entry would point at the
              build folder and replace your installed copy&apos;s.
            </p>
          </div>

          <div className="mt-2 border-t border-line pt-3">
            <h3 className="mb-1 text-xs font-medium text-ink">Discord</h3>
            <CheckboxRow
              checked={discordRichPresence}
              onChange={(v) => setSetting("discordRichPresence", v)}
              label="Show Rich Presence in Discord"
              hint="Shows a server you're playing on (or 'Browsing servers') on your Discord profile. Off means the launcher never talks to Discord at all."
            />
          </div>

          <div className="mt-2 border-t border-line pt-3">
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
                  className={cn(INPUT_CLASS, "cursor-text font-mono text-[10px]")}
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
        </SettingsAccordion>

        <SettingsAccordion
          id="browser"
          icon={<Filter className="h-[17px] w-[17px]" />}
          title={SECS[2].title}
          description={SECS[2].description}
          open={openSec === "browser"}
          onToggle={() => toggle("browser")}
          onKeyDown={(e) => rove(e, 2)}
        >
          <div>
            <h3 className="mb-0.5 text-xs font-medium text-ink">Hide noise</h3>
            <p className="mb-1.5 text-[10px] leading-relaxed text-muted">
              Roughly a third of a raw server list is entries you can do nothing with. Servers
              that have never answered a probe — no name, no players, no map — are always hidden.
              The rest is judged on the server&apos;s name alone, offline.
            </p>
            <CheckboxRow
              checked={hidePlaceholderServers}
              onChange={(v) => setSetting("hidePlaceholderServers", v)}
              label="Default hoster names"
              hint='Any name carrying a hosting company, plus templates like "EXAMPLE NAME".'
            />
          </div>

          <div className="mt-2 border-t border-line pt-3">
            <Field label="Auto-refresh" hint="Re-queries the servers on screen, not the whole list.">
              <select
                value={autoRefreshIntervalSecs}
                onChange={(e) =>
                  setSetting("autoRefreshIntervalSecs", Number(e.target.value))
                }
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

          <div className="mt-2 border-t border-line pt-3">
            <Field
              label="Language"
              hint="Read from the name — its script, [GER]/[RU]-style tags, accented letters and non-English words. A server that is foreign but says so nowhere in its name will still appear."
            >
              <select
                value={englishNamesFilter === null ? "all" : englishNamesFilter ? "en" : "other"}
                onChange={(e) =>
                  setSetting(
                    "englishNamesFilter",
                    e.target.value === "all" ? null : e.target.value === "en",
                  )
                }
                className={cn(INPUT_CLASS, "cursor-pointer")}
              >
                <option value="en">English servers only</option>
                <option value="other">Non-English servers only</option>
                <option value="all">All languages</option>
              </select>
            </Field>
          </div>
        </SettingsAccordion>

        <SettingsAccordion
          id="theme"
          icon={<Palette className="h-[17px] w-[17px]" />}
          title={SECS[3].title}
          description={SECS[3].description}
          open={openSec === "theme"}
          onToggle={() => toggle("theme")}
          onKeyDown={(e) => rove(e, 3)}
        >
          <ThemeCustomiser />
        </SettingsAccordion>
      </div>
    </div>
  );
}

/** A labelled control with an optional explanatory line beneath it. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field mb-3.5">
      <div className="fb text-[10px] font-semibold text-ink">{label}</div>
      {hint && <div className="fh mt-0.5 text-[9px] leading-[1.4] text-muted">{hint}</div>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** A checkbox with a label and a one-line explanation. */
function CheckboxRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="chk flex cursor-pointer items-start gap-2 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="cl block text-[11px] text-ink">{label}</span>
        {hint && <span className="ch mt-0.5 block text-[9px] leading-[1.4] text-muted">{hint}</span>}
      </span>
    </label>
  );
}
