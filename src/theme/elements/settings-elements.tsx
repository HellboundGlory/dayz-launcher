import { useEffect, useId, useState, type CSSProperties } from "react";
import { Check, ChevronLeft, Code, Download, Folder, Globe, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { cn } from "@/lib/utils";
import { LAUNCH_TOGGLES, hasLaunchFlag, setLaunchFlag } from "@/lib/launch-toggles";
import { openExternalUrl } from "@/lib/external-link";
import { useUpdateStore } from "@/stores/update-store";
import { OptionIcon } from "./option-icon";
import { useSettingsStore } from "@/stores/settings-store";
import { discoverSteamPaths, dataFolderPath, openDataFolder } from "@/lib/tauri";
import { ThemesSection } from "@/components/themes-page/themes-section";
import { SECS, REFRESH_INTERVALS, INPUT_CLASS, BUTTON_CLASS, Field, CheckboxRow } from "./settings-controls";
import { useElementContext } from "./context";
import { parseDisplay } from "./element-utils";

interface ElementProps {
  options?: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
}

function showHintOption(options?: Record<string, unknown>): boolean {
  return options?.showHint !== false;
}

export function SettingsBack({ options, className, style }: ElementProps) {
  const { onCloseSettings } = useElementContext();
  const { showIcon, showLabel } = parseDisplay(options, "label");

  return (
    <button
      type="button"
      data-el="settings.back"
      onClick={onCloseSettings}
      aria-label="Back to the launcher"
      className={
        className ??
        "flex items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold text-muted2 transition-colors hover:border-accent-line hover:text-ink"
      }
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={ChevronLeft} className="h-3 w-3" />
        </span>
      )}
      {showLabel && <span data-part="label">Back</span>}
    </button>
  );
}

export function SettingsDone({ options, className, style }: ElementProps) {
  const { onCloseSettings } = useElementContext();
  const { showIcon, showLabel } = parseDisplay(options, "label");

  return (
    <button
      type="button"
      data-el="settings.done"
      onClick={onCloseSettings}
      className={
        className ??
        "flex items-center gap-1.5 [border-radius:var(--t-radius-control)] bg-accent px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wide text-bg transition-[filter] hover:brightness-110"
      }
      style={style}
    >
      {showIcon && (
        <span data-part="icon">
          <OptionIcon icon={options?.icon} fallback={Check} className="h-3 w-3" />
        </span>
      )}
      {showLabel && <span data-part="label">Done</span>}
    </button>
  );
}

export function SettingsTitle({ className, style }: Omit<ElementProps, "options">) {
  return (
    <h2 data-el="settings.title" className={className ?? "m-0 [font-size:var(--t-type-size-2xl)] leading-5 font-bold text-ink"} style={style}>
      <span data-part="text">Settings</span>
    </h2>
  );
}

export function SettingsProfileName({ options, className, style }: ElementProps) {
  const profileName = useSettingsStore((s) => s.profileName);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <Field
      dataEl="settings.profileName"
      label="In-Game Name"
      hint='Sets -name= at launch, so you are not "Survivor".'
      showHint={showHint}
      htmlFor={id}
      hintId={hintId}
      className={className}
      style={style}
    >
      <input
        id={id}
        type="text"
        value={profileName}
        onChange={(e) => setSetting("profileName", e.target.value)}
        placeholder="Set your DayZ profile name"
        aria-describedby={showHint ? hintId : undefined}
        className={INPUT_CLASS}
      />
    </Field>
  );
}

export function SettingsDayzPath({ options, className, style }: ElementProps) {
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <Field
      dataEl="settings.dayzPath"
      label="DayZ Install Path"
      hint="Manual override, for when Steam registry detection fails."
      showHint={showHint}
      htmlFor={id}
      hintId={hintId}
      className={className}
      style={style}
    >
      <input
        id={id}
        type="text"
        value={dayzPath ?? ""}
        onChange={(e) => setSetting("dayzPath", e.target.value || null)}
        placeholder="C:\Program Files (x86)\Steam\steamapps\common\DayZ"
        aria-describedby={showHint ? hintId : undefined}
        className={INPUT_CLASS}
      />
    </Field>
  );
}

export function SettingsDetectPaths({ className, style }: Omit<ElementProps, "options">) {
  const setSetting = useSettingsStore((s) => s.setSetting);
  const [detecting, setDetecting] = useState(false);

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
    <button
      type="button"
      data-el="settings.detectPaths"
      data-state={detecting ? "busy" : undefined}
      onClick={() => void detectPaths()}
      disabled={detecting}
      className={className ?? BUTTON_CLASS}
      style={style}
    >
      <Folder className="size-3" />
      <span data-part="label">{detecting ? "…" : "Detect"}</span>
    </button>
  );
}

export function SettingsWorkshopPath({ options, className, style }: ElementProps) {
  const workshopPath = useSettingsStore((s) => s.workshopPath);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <Field
      dataEl="settings.workshopPath"
      label="Workshop Content"
      hint="Detected from Steam. Read-only."
      showHint={showHint}
      htmlFor={id}
      hintId={hintId}
      className={className}
      style={style}
    >
      <input
        id={id}
        type="text"
        value={workshopPath ?? ""}
        readOnly
        placeholder="Not detected yet"
        aria-describedby={showHint ? hintId : undefined}
        className={cn(INPUT_CLASS, "cursor-default text-muted2")}
      />
    </Field>
  );
}

export function SettingsLaunchParams({ options, className, style }: ElementProps) {
  const launchParams = useSettingsStore((s) => s.launchParams);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <Field
      dataEl="settings.launchParams"
      label="Custom Launch Parameters"
      hint={
        "One per line, passed to DayZ ahead of the mod list. The boxes above add and remove their own lines here."
      }
      showHint={showHint}
      htmlFor={id}
      hintId={hintId}
      className={className}
      style={style}
    >
      <div data-part="toggles" className="mb-2">
        <div
          data-part="toggles-label"
          className="mb-1 [font-size:var(--t-type-label-size)] font-semibold text-ink"
        >
          Launch options
        </div>
        {LAUNCH_TOGGLES.map((toggle) => {
          const checked = hasLaunchFlag(launchParams, toggle.flag);
          return (
            <label
              key={toggle.id}
              data-part="toggle"
              data-state={checked ? "checked" : undefined}
              className="flex cursor-pointer items-center gap-2 py-1"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) =>
                  setSetting(
                    "launchParams",
                    setLaunchFlag(launchParams, toggle.flag, e.target.checked),
                  )
                }
                data-part="box"
                className="size-3.5 shrink-0 accent-accent"
              />
              <span data-part="name" className="[font-size:var(--t-type-body-size)] text-ink">
                {toggle.name}
              </span>
              <span data-part="flag" className="font-mono [font-size:var(--t-type-caption-size)] text-muted">
                {toggle.flag}
              </span>
            </label>
          );
        })}
      </div>
      <textarea
        id={id}
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
        aria-describedby={showHint ? hintId : undefined}
        className={cn(INPUT_CLASS, "resize-y font-mono [font-size:var(--t-type-body-size)]")}
      />
    </Field>
  );
}

export function SettingsOnJoin({ options, className, style }: ElementProps) {
  const onJoin = useSettingsStore((s) => s.onJoin);
  const startWindow = useSettingsStore((s) => s.startWindow);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;
  const startWindowHintId = `${id}-start-window-hint`;

  return (
    <Field
      dataEl="settings.onJoin"
      label="When you join a server"
      hint="DayZ takes a few seconds to appear, so the launcher waits before getting out of the way."
      showHint={showHint}
      htmlFor={id}
      hintId={hintId}
      className={className}
      style={style}
    >
      <select
        id={id}
        value={onJoin}
        onChange={(e) => setSetting("onJoin", e.target.value as typeof onJoin)}
        aria-describedby={showHint ? hintId : undefined}
        className={cn(INPUT_CLASS, "cursor-pointer")}
      >
        <option value="stay">Leave the launcher open</option>
        <option value="tray">Hide the launcher to the tray</option>
        <option value="close">Close the launcher</option>
      </select>
      <div className="mt-1.5">
        <CheckboxRow
          id={`${id}-start-window`}
          hintId={startWindowHintId}
          showHint={showHint}
          checked={startWindow}
          onChange={(v) => setSetting("startWindow", v)}
          label="Show the starting window"
          hint="Lists each step of the join as it runs, and closes itself once DayZ is running."
        />
      </div>
    </Field>
  );
}

export function SettingsMinimiseToTray({ options, className, style }: ElementProps) {
  const minimiseToTray = useSettingsStore((s) => s.minimiseToTray);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <CheckboxRow
      dataEl="settings.minimiseToTray"
      dataState={minimiseToTray ? "checked" : undefined}
      id={id}
      hintId={hintId}
      showHint={showHint}
      checked={minimiseToTray}
      onChange={(v) => setSetting("minimiseToTray", v)}
      label="Minimise to the system tray"
      hint="The minimise button hides the launcher instead of leaving it on the taskbar."
      className={className}
      style={style}
    />
  );
}

export function SettingsCloseToTray({ options, className, style }: ElementProps) {
  const closeToTray = useSettingsStore((s) => s.closeToTray);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <CheckboxRow
      dataEl="settings.closeToTray"
      dataState={closeToTray ? "checked" : undefined}
      id={id}
      hintId={hintId}
      showHint={showHint}
      checked={closeToTray}
      onChange={(v) => setSetting("closeToTray", v)}
      label="Close to the system tray"
      hint="The close button hides the launcher instead of quitting. Quit from the tray icon's menu."
      className={className}
      style={style}
    />
  );
}

export function SettingsStartWithWindows({ options, className, style }: ElementProps) {
  const startWithWindows = useSettingsStore((s) => s.startWithWindows);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div
      data-el="settings.startWithWindows"
      data-state={startWithWindows ? "checked" : undefined}
      className={className}
      style={style}
    >
      <CheckboxRow
        id={id}
        hintId={hintId}
        showHint={showHint}
        checked={startWithWindows}
        onChange={(v) => setSetting("startWithWindows", v)}
        label="Start with Windows"
        hint="Runs the launcher when you sign in."
      />
      <p data-part="note" className="mt-1.5 [font-size:var(--t-type-label-size)] leading-relaxed text-muted">
        Start with Windows does nothing in a debug build — the entry would point at the build folder
        and replace your installed copy&apos;s.
      </p>
    </div>
  );
}

export function SettingsStartMinimised({ options, className, style }: ElementProps) {
  const startWithWindows = useSettingsStore((s) => s.startWithWindows);
  const startMinimised = useSettingsStore((s) => s.startMinimised);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;
  const disabled = !startWithWindows;
  const dataState = [startMinimised && "checked", disabled && "disabled"].filter(Boolean).join(" ") || undefined;

  return (
    <CheckboxRow
      dataEl="settings.startMinimised"
      dataState={dataState}
      id={id}
      hintId={hintId}
      showHint={showHint}
      checked={startMinimised}
      disabled={disabled}
      onChange={(v) => setSetting("startMinimised", v)}
      label="Start minimised"
      hint="Start hidden in the tray. Opening the launcher yourself always shows the window."
      className={className}
      style={style}
    />
  );
}

export function SettingsDiscordPresence({ options, className, style }: ElementProps) {
  const discordRichPresence = useSettingsStore((s) => s.discordRichPresence);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <CheckboxRow
      dataEl="settings.discordPresence"
      dataState={discordRichPresence ? "checked" : undefined}
      id={id}
      hintId={hintId}
      showHint={showHint}
      checked={discordRichPresence}
      onChange={(v) => setSetting("discordRichPresence", v)}
      label="Show Rich Presence in Discord"
      hint="Shows a server you're playing on (or 'Browsing servers') on your Discord profile. Off means the launcher never talks to Discord at all."
      className={className}
      style={style}
    />
  );
}

export function SettingsDataFolder({ options, className, style }: ElementProps) {
  const [dataFolder, setDataFolder] = useState<string | null>(null);
  useEffect(() => {
    dataFolderPath()
      .then(setDataFolder)
      .catch(() => {});
  }, []);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <Field
      dataEl="settings.dataFolder"
      label="Data folder"
      hint="Your favourites, server list and settings. Back this folder up to keep them; deleting it resets the launcher."
      showHint={showHint}
      htmlFor={id}
      hintId={hintId}
      className={className}
      style={style}
    >
      <input
        id={id}
        readOnly
        value={dataFolder ?? "Locating…"}
        onFocus={(e) => e.currentTarget.select()}
        aria-describedby={showHint ? hintId : undefined}
        className={cn(INPUT_CLASS, "cursor-text font-mono [font-size:var(--t-type-label-size)]")}
      />
    </Field>
  );
}

export function SettingsOpenDataFolder({ className, style }: Omit<ElementProps, "options">) {
  const [dataFolder, setDataFolder] = useState<string | null>(null);
  useEffect(() => {
    dataFolderPath()
      .then(setDataFolder)
      .catch(() => {});
  }, []);
  const disabled = !dataFolder;

  return (
    <button
      type="button"
      data-el="settings.openDataFolder"
      data-state={disabled ? "disabled" : undefined}
      onClick={() => void openDataFolder()}
      disabled={disabled}
      className={className ?? BUTTON_CLASS}
      style={style}
    >
      <Folder className="size-3" />
      <span data-part="label">Open</span>
    </button>
  );
}

export function SettingsAutoRefresh({ options, className, style }: ElementProps) {
  const autoRefreshIntervalSecs = useSettingsStore((s) => s.autoRefreshIntervalSecs);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const showHint = showHintOption(options);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <Field
      dataEl="settings.autoRefresh"
      label="Auto-refresh"
      hint="Re-queries the first 5,000 servers in the list's current order, not all of them. Defaults to a minute — ping is measured from your connection, so rows get their numbers shortly after every load."
      showHint={showHint}
      htmlFor={id}
      hintId={hintId}
      className={className}
      style={style}
    >
      <select
        id={id}
        value={autoRefreshIntervalSecs}
        onChange={(e) => setSetting("autoRefreshIntervalSecs", Number(e.target.value))}
        aria-describedby={showHint ? hintId : undefined}
        className={cn(INPUT_CLASS, "cursor-pointer")}
      >
        {REFRESH_INTERVALS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SettingsThemeManagement({ className, style }: Omit<ElementProps, "options">) {
  const { devMode, onDevModeChange } = useElementContext();
  return (
    <div data-el="settings.themeManagement" className={className} style={style}>
      <ThemesSection devMode={devMode} onDevModeChange={onDevModeChange} />
    </div>
  );
}

const WEBSITE_URL = "https://tetralauncher.com";
const SOURCE_URL = "https://github.com/HellboundGlory/dayz-launcher";
const DOWNLOAD_URL = "https://tetralauncher.com/download";

export function SettingsAbout({ className, style }: Omit<ElementProps, "options">) {
  const [version, setVersion] = useState<string | null>(null);
  const installed = useUpdateStore((s) => s.installed);
  const checking = useUpdateStore((s) => s.checking);
  const checked = useUpdateStore((s) => s.checked);
  const available = useUpdateStore((s) => s.available);
  const installing = useUpdateStore((s) => s.installing);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const checkNow = useUpdateStore((s) => s.checkNow);
  const install = useUpdateStore((s) => s.install);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const open = (url: string) => void openExternalUrl(url).catch((e) => console.error(e));

  const onUpdate = () => {
    // Only a copy known to be portable goes to the download page.
    if (installed === false) open(DOWNLOAD_URL);
    else void install();
  };

  const status = installing
    ? progress?.total
      ? `Downloading… ${Math.round((progress.downloaded / progress.total) * 100)}%`
      : "Downloading…"
    : checking
      ? "Checking…"
      : error
        ? `${available ? "Couldn't update" : "Couldn't check"}: ${error}`
        : !available && checked
          ? "You're up to date."
          : null;

  return (
    <div data-el="settings.about" className={className ?? "flex flex-col gap-5"} style={style}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="[font-size:var(--t-type-label-size)] font-semibold uppercase tracking-[0.09em] text-muted">
            Version
          </span>
          <span data-part="links" className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Website"
              title="Website: tetralauncher.com"
              onClick={() => open(WEBSITE_URL)}
              className="grid size-[26px] place-items-center [border-radius:var(--t-radius-control)] border border-line text-muted2 transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:border-accent-line hover:text-ink"
            >
              <Globe className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Source code on GitHub"
              title="Source code on GitHub"
              onClick={() => open(SOURCE_URL)}
              className="grid size-[26px] place-items-center [border-radius:var(--t-radius-control)] border border-line text-muted2 transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:border-accent-line hover:text-ink"
            >
              <Code className="size-3.5" />
            </button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span data-part="version" className="[font-size:var(--t-type-size-xl)] text-ink">
            Tetra Launcher{version && <span className="ml-1.5 font-mono">{version}</span>}
          </span>
          <span className="relative inline-flex" title={available ? `Version ${available.version} is available` : undefined}>
            <button
              type="button"
              data-part="button"
              data-state={available ? "update" : undefined}
              disabled={checking || installing}
              aria-label={available && !installing ? `Update to version ${available.version}` : undefined}
              onClick={() => (available ? onUpdate() : void checkNow())}
              className={cn(
                "flex shrink-0 items-center gap-1.5 [border-radius:var(--t-radius-control)] px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider transition-colors [transition-duration:var(--t-motion-hover-duration)] disabled:opacity-50",
                available
                  ? "border border-accent bg-accent text-bg hover:brightness-110"
                  : "border border-line bg-surface2 text-muted2 hover:text-ink",
              )}
            >
              {available ? <Download className="size-3" /> : <RefreshCw className="size-3" />}
              <span data-part="label">
                {installing ? "Updating…" : available ? "Update" : "Check for updates"}
              </span>
            </button>
            {available && (
              <span
                data-part="badge"
                aria-hidden
                className="pointer-events-none absolute -right-1 -top-1 size-2.5 [border-radius:var(--t-radius-pill)] bg-success shadow-[0_0_0_2px_var(--surface)]"
              />
            )}
          </span>
          {status ? (
            <span data-part="status" role="status" className="[font-size:var(--t-type-caption-size)] text-muted">
              {status}
            </span>
          ) : (
            available && (
              <button
                type="button"
                data-part="whatsnew"
                onClick={() =>
                  open(`https://github.com/HellboundGlory/dayz-launcher/releases/tag/v${encodeURIComponent(available.version)}`)
                }
                className="flex shrink-0 items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-[var(--t-space-controlX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-wider text-muted2 transition-colors [transition-duration:var(--t-motion-hover-duration)] hover:text-ink"
              >
                <span data-part="label">See what&apos;s new</span>
              </button>
            )
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <span className="[font-size:var(--t-type-label-size)] font-semibold uppercase tracking-[0.09em] text-muted">
          Credits
        </span>
        <div data-part="credits" className="flex flex-col gap-1.5">
          <p className="m-0 [font-size:var(--t-type-size-lg)] leading-relaxed text-muted2">
            IP geolocation by DB-IP (https://db-ip.com), CC BY 4.0
            (https://creativecommons.org/licenses/by/4.0/), converted to a compact IPv4 range table
          </p>
          <p className="m-0 [font-size:var(--t-type-size-lg)] leading-relaxed text-muted2">
            Flag icons: country-flag-icons by catamphetamine, MIT licence
          </p>
          <p className="m-0 [font-size:var(--t-type-caption-size)] text-muted">
            Full licence texts are in the NOTICE file that comes with Tetra.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SettingsSectionTitle({ options, className, style }: ElementProps) {
  const sec = SECS.find((s) => s.id === options?.section);
  if (!sec) return null;
  return (
    <span data-el="settings.sectionTitle" className={className} style={style}>
      <span data-part="text">{sec.title}</span>
    </span>
  );
}

export function SettingsSectionDescription({ options, className, style }: ElementProps) {
  const sec = SECS.find((s) => s.id === options?.section);
  if (!sec) return null;
  return (
    <span data-el="settings.sectionDescription" className={className} style={style}>
      <span data-part="text">{sec.description}</span>
    </span>
  );
}

export function SettingsSectionIcon({ options, className, style }: ElementProps) {
  const sec = SECS.find((s) => s.id === options?.section);
  if (!sec) return null;
  return (
    <span data-el="settings.sectionIcon" className={className} style={style}>
      <span data-part="icon">
        <OptionIcon icon={options?.icon} fallback={sec.icon} className="h-[17px] w-[17px]" />
      </span>
    </span>
  );
}

const GROUP_TITLES: Record<string, string> = {
  window: "Window",
  startup: "Startup",
  discord: "Discord",
};

export function SettingsGroupTitle({ options, className, style }: ElementProps) {
  const title = GROUP_TITLES[options?.group as string];
  if (!title) return null;
  return (
    <div data-el="settings.groupTitle" className={className} style={style}>
      <span data-part="text">{title}</span>
    </div>
  );
}
