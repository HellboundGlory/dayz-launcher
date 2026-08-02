import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import {
  X,
  Folder,
  RefreshCw,
  Download,
  ExternalLink,
  CheckCircle2,
  Gamepad2,
  Filter,
  AppWindow,
} from "lucide-react";
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

type TabId = "game" | "launcher" | "browser" | "updates";

const TABS: { id: TabId; label: string; icon: typeof Gamepad2 }[] = [
  { id: "game", label: "Game", icon: Gamepad2 },
  { id: "launcher", label: "Launcher", icon: AppWindow },
  { id: "browser", label: "Server Browser", icon: Filter },
  { id: "updates", label: "Updates", icon: Download },
];

/** The auto-refresh choices, in seconds. `0` is off. */
const REFRESH_INTERVALS: { value: number; label: string }[] = [
  { value: 0, label: "Never" },
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 600, label: "Every 10 minutes" },
];

// ─── Form vocabulary ─────────────────────────────────────────────────────────
//
// One shape per control type, used everywhere. The previous version styled each
// input at its call site, so the four text fields had drifted into three
// slightly different ring and padding combinations.

/** Secondary prose — hints, explanations, placeholders.
 *
 *  `#7c8ba1`, not the `#64748b` this modal used to use everywhere: at the 10px
 *  these lines run, `#64748b` measures 3.74:1 against the panel and 3.45:1
 *  against the checkbox hover state, both under the 4.5:1 floor. This clears
 *  4.7:1 on every surface in the modal while staying visibly secondary. */
const MUTED = "#7c8ba1";

/** The shared text-input styling — the single source of it. */
const INPUT_CLASS =
  "w-full rounded-md bg-[#0d131d] px-2.5 py-2 text-xs text-[#f1f5f9] placeholder-[#7c8ba1] outline-none ring-1 ring-[#1e293b] transition-colors duration-150 focus:ring-[#38bdf8] hover:ring-[#2b3a4f]";

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
    <div>
      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8]">
        {label}
      </label>
      {children}
      {hint && (
        <p className="mt-1.5 text-[10px] leading-relaxed" style={{ color: MUTED }}>
          {hint}
        </p>
      )}
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
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="group flex cursor-pointer items-start gap-2.5 rounded-md p-2 -mx-2 transition-colors duration-150 hover:bg-[#16202e]/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-[#38bdf8]"
      />
      <span>
        <span className="block text-xs text-[#f1f5f9]">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed" style={{ color: MUTED }}>
          {hint}
        </span>
      </span>
    </label>
  );
}

export function SettingsModal({ open: isOpen, onClose }: SettingsModalProps) {
  // Field selectors rather than a whole-store subscription. This modal really
  // does read most of the store, but `setSetting` is what the inputs call and
  // pulling it out separately keeps the subscription list explicit.
  const profileName = useSettingsStore((s) => s.profileName);
  const dayzPath = useSettingsStore((s) => s.dayzPath);
  const workshopPath = useSettingsStore((s) => s.workshopPath);
  const autoJoinAfterDownload = useSettingsStore((s) => s.autoJoinAfterDownload);
  const hideUnnamedServers = useSettingsStore((s) => s.hideUnnamedServers);
  const hidePlaceholderServers = useSettingsStore((s) => s.hidePlaceholderServers);
  const englishNamesFilter = useSettingsStore((s) => s.englishNamesFilter);
  const launchParams = useSettingsStore((s) => s.launchParams);
  const closeToTray = useSettingsStore((s) => s.closeToTray);
  const startWithWindows = useSettingsStore((s) => s.startWithWindows);
  const startMinimised = useSettingsStore((s) => s.startMinimised);
  const onJoin = useSettingsStore((s) => s.onJoin);
  const autoRefreshIntervalSecs = useSettingsStore((s) => s.autoRefreshIntervalSecs);
  const setSetting = useSettingsStore((s) => s.setSetting);

  const [detecting, setDetecting] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("game");
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

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

  // Escape closes. Bound only while open, so a closed modal keeps no
  // document-level listener alive — the same rule the filter-bar popovers use.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

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

  /** Up/Down move between tabs, which is what a vertical tablist owes a
   *  keyboard user; Home/End jump to the ends. */
  function onTabKeyDown(e: React.KeyboardEvent) {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === "ArrowDown") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowUp") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    const id = TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
      // Backdrop click closes. Guarded on the target so a click that starts
      // inside the panel and drifts out does not shut the modal.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex max-h-[82vh] w-[640px] flex-col overflow-hidden rounded-xl border border-[#1e293b] bg-[#111823] shadow-2xl shadow-black/50"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#1e293b] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[#f1f5f9]">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-[#64748b] transition-colors duration-150 hover:bg-[#16202e] hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#38bdf8]"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body: nav rail + panel */}
        <div className="flex min-h-0 flex-1">
          {/* The rail is its own neutral layer, a shade below the panel, so the
              selected tab reads as raised into the content rather than painted
              onto it. */}
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings sections"
            onKeyDown={onTabKeyDown}
            className="w-44 shrink-0 space-y-0.5 border-r border-[#1e293b] bg-[#0d131d] p-2.5"
          >
            {TABS.map(({ id, label, icon: Icon }) => {
              const selected = tab === id;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  role="tab"
                  id={`settings-tab-${id}`}
                  aria-selected={selected}
                  aria-controls={`settings-panel-${id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#38bdf8]",
                    selected
                      ? "bg-[#16202e] font-medium text-[#f1f5f9]"
                      : "text-[#94a3b8] hover:bg-[#16202e]/50 hover:text-[#f1f5f9]"
                  )}
                >
                  <Icon
                    className={cn("size-3.5 shrink-0", selected ? "text-[#38bdf8]" : "text-[#64748b]")}
                  />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Panel. Scrolls on its own so the header, rail and footer stay put
              however tall a section grows. */}
          <div
            role="tabpanel"
            id={`settings-panel-${tab}`}
            aria-labelledby={`settings-tab-${tab}`}
            tabIndex={0}
            // The floor is the tallest tab's natural height, so the dialog is
            // one size whichever section is open — otherwise it jumps ~90px
            // between Game and Updates, moving the rail and the Done button out
            // from under the cursor mid-task. Re-measure this if a tab grows.
            className="min-h-[480px] flex-1 space-y-5 overflow-y-auto px-5 py-4 focus-visible:outline-none"
          >
            {tab === "game" && (
              <>
                <Field
                  label="In-Game Name"
                  hint={'Sets -name= at launch, so you are not "Survivor".'}
                >
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
                    <button
                      onClick={detectPaths}
                      disabled={detecting}
                      className="flex shrink-0 items-center gap-1.5 rounded-md bg-[#16202e] px-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] transition-colors duration-150 hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-[#38bdf8] disabled:opacity-50"
                    >
                      <Folder className="size-3" />
                      {detecting ? "…" : "Detect"}
                    </button>
                  </div>
                </Field>

                {/* Always rendered, so the tab does not change height the first
                    time a path is detected. */}
                <Field label="Workshop Content" hint="Detected from Steam. Read-only.">
                  <input
                    type="text"
                    value={workshopPath ?? ""}
                    readOnly
                    placeholder="Not detected yet"
                    className="w-full cursor-default rounded-md bg-[#0b0f17] px-2.5 py-2 text-xs text-[#94a3b8] placeholder-[#7c8ba1] outline-none ring-1 ring-[#1e293b]"
                  />
                </Field>

                {/* The store holds an array because that is what the launch
                    command takes; the field edits it as a line of text. Split
                    on whitespace, which is how DayZ's own command line reads —
                    a parameter with a space in it needs the array, and nothing
                    in DayZ's documented set has one. */}
                <Field
                  label="Custom Launch Parameters"
                  hint="Passed to DayZ ahead of the mod list. Example: -noPause -cpuCount=4"
                >
                  <input
                    type="text"
                    value={launchParams.join(" ")}
                    onChange={(e) =>
                      setSetting(
                        "launchParams",
                        e.target.value.split(/\s+/).filter(Boolean)
                      )
                    }
                    placeholder="-noPause -cpuCount=4"
                    spellCheck={false}
                    className={INPUT_CLASS}
                  />
                </Field>

                <div className="border-t border-[#1e293b] pt-4">
                  <CheckboxRow
                    checked={autoJoinAfterDownload}
                    onChange={(v) => setSetting("autoJoinAfterDownload", v)}
                    label="Auto-join after downloading"
                    hint="Launch automatically once every required mod has finished downloading."
                  />
                </div>
              </>
            )}

            {tab === "launcher" && (
              <>
                <div>
                  <h3 className="mb-2 text-xs font-medium text-[#f1f5f9]">Window</h3>
                  <CheckboxRow
                    checked={closeToTray}
                    onChange={(v) => setSetting("closeToTray", v)}
                    label="Close to tray"
                    hint="The close button hides the launcher instead of quitting. Quit from the tray icon."
                  />
                </div>

                <div className="border-t border-[#1e293b] pt-4">
                  <Field
                    label="When you join a server"
                    hint="DayZ takes a few seconds to appear, so the launcher waits before getting out of the way."
                  >
                    <select
                      value={onJoin}
                      onChange={(e) =>
                        setSetting("onJoin", e.target.value as typeof onJoin)
                      }
                      className={cn(INPUT_CLASS, "cursor-pointer")}
                    >
                      <option value="stay">Leave the launcher open</option>
                      <option value="tray">Hide the launcher to the tray</option>
                      <option value="close">Close the launcher</option>
                    </select>
                  </Field>
                </div>

                <div className="border-t border-[#1e293b] pt-4">
                  <h3 className="mb-2 text-xs font-medium text-[#f1f5f9]">Startup</h3>
                  <CheckboxRow
                    checked={startWithWindows}
                    onChange={(v) => setSetting("startWithWindows", v)}
                    label="Start with Windows"
                    hint="Runs the launcher when you sign in."
                  />
                  {/* Meaningless on its own: nobody opens an app by hand in
                      order for it not to appear. Disabled rather than hidden so
                      the dependency is visible instead of the row vanishing. */}
                  <div className={cn(!startWithWindows && "opacity-40")}>
                    <label
                      className={cn(
                        "group flex items-start gap-2.5 rounded-md p-2 -mx-2 transition-colors duration-150",
                        startWithWindows
                          ? "cursor-pointer hover:bg-[#16202e]/60"
                          : "cursor-not-allowed"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={startMinimised}
                        disabled={!startWithWindows}
                        onChange={(e) => setSetting("startMinimised", e.target.checked)}
                        className="mt-0.5 size-3.5 shrink-0 accent-[#38bdf8] disabled:cursor-not-allowed"
                      />
                      <span>
                        <span className="block text-xs text-[#f1f5f9]">Start minimised</span>
                        <span
                          className="mt-0.5 block text-[10px] leading-relaxed"
                          style={{ color: MUTED }}
                        >
                          Start hidden in the tray. Opening the launcher yourself always
                          shows the window.
                        </span>
                      </span>
                    </label>
                  </div>
                  <p
                    className="mt-2 text-[10px] leading-relaxed"
                    style={{ color: MUTED }}
                  >
                    Start with Windows does nothing in a debug build — the entry would
                    point at the build folder and replace your installed copy's.
                  </p>
                </div>
              </>
            )}

            {tab === "browser" && (
              <>
                <div>
                  <h3 className="mb-1 text-xs font-medium text-[#f1f5f9]">Hide noise</h3>
                  <p className="mb-2 text-[10px] leading-relaxed" style={{ color: MUTED }}>
                    Roughly a third of a raw server list is entries you can do nothing
                    with. All of this is judged on the server's name alone, offline.
                  </p>
                  <div className="space-y-0.5">
                    <CheckboxRow
                      checked={hideUnnamedServers}
                      onChange={(v) => setSetting("hideUnnamedServers", v)}
                      label="Servers with no name"
                      hint="Never answered a probe, so they show no name and 0 players."
                    />
                    <CheckboxRow
                      checked={hidePlaceholderServers}
                      onChange={(v) => setSetting("hidePlaceholderServers", v)}
                      label="Default hoster names"
                      hint='Any name carrying a hosting company, plus templates like "EXAMPLE NAME".'
                    />
                  </div>
                </div>

                <div className="border-t border-[#1e293b] pt-4">
                  <Field
                    label="Auto-refresh"
                    hint="Re-queries the servers on screen, not the whole list."
                  >
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

                <div className="border-t border-[#1e293b] pt-4">
                  <Field
                    label="Language"
                    hint="Read from the name — its script, [GER]/[RU]-style tags, accented letters and non-English words. A server that is foreign but says so nowhere in its name will still appear."
                  >
                    <select
                      value={
                        englishNamesFilter === null ? "all" : englishNamesFilter ? "en" : "other"
                      }
                      onChange={(e) =>
                        setSetting(
                          "englishNamesFilter",
                          e.target.value === "all" ? null : e.target.value === "en"
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
              </>
            )}

            {tab === "updates" && (
              <>
                <Field label="Version">
                  <div className="flex items-center justify-between gap-2 rounded-md bg-[#0d131d] px-2.5 py-2 ring-1 ring-[#1e293b]">
                    <span className="text-xs text-[#94a3b8]">
                      {currentVersion ? `Tetra Launcher v${currentVersion}` : "Tetra Launcher"}
                    </span>
                    <button
                      onClick={() => void checkNow()}
                      disabled={checking || installing}
                      className="flex items-center gap-1.5 rounded-md bg-[#16202e] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] transition-colors duration-150 hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-[#38bdf8] disabled:opacity-50"
                    >
                      <RefreshCw className={cn("size-3", checking && "animate-spin")} />
                      {checking ? "Checking…" : "Check now"}
                    </button>
                  </div>
                </Field>

                {updateError && <p className="text-[10px] text-[#ef4444]">{updateError}</p>}

                {available ? (
                  <div className="rounded-md bg-[#38bdf8]/5 px-3 py-2.5 ring-1 ring-[#38bdf8]/20">
                    <p className="text-xs font-medium text-[#f1f5f9]">
                      v{available.version} is available
                    </p>
                    {available.body && (
                      <p className="mt-1 line-clamp-3 text-[10px] leading-relaxed text-[#94a3b8]">
                        {available.body}
                      </p>
                    )}

                    {installed === true ? (
                      installing ? (
                        <p className="mt-2 text-[10px]" style={{ color: MUTED }}>
                          {progress?.total
                            ? `Downloading… ${Math.round((progress.downloaded / progress.total) * 100)}%`
                            : "Downloading…"}
                        </p>
                      ) : (
                        <button
                          onClick={() => void install()}
                          className="mt-2 flex items-center gap-1.5 rounded-md bg-[#38bdf8] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#0b0f17] transition-colors duration-150 hover:bg-[#7dd3fc] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7dd3fc]"
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
                        className="mt-2 flex items-center gap-1.5 rounded-md bg-[#16202e] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94a3b8] ring-1 ring-[#1e293b] transition-colors duration-150 hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-[#38bdf8]"
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
                    <p
                      className="flex items-center gap-1.5 text-[10px]"
                      style={{ color: MUTED }}
                    >
                      <CheckCircle2 className="size-3 text-[#22c55e]" />
                      You're up to date
                    </p>
                  )
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end border-t border-[#1e293b] px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md bg-[#38bdf8] px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#0b0f17] transition-colors duration-150 hover:bg-[#7dd3fc] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7dd3fc]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
