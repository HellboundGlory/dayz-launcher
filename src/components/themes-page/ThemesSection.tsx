import { useState } from "react";
import { Upload, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useThemeStore,
  activePreset,
  activeInstalled,
  resolvedPair,
} from "@/theme/theme-store";
import { PRESETS } from "@/theme/palette";
import { ThemeCustomiser } from "../theme-customiser";
import { ThemeGrid, nextDuplicateName } from "./ThemeGrid";
import { ImportThemeDialog } from "./ImportThemeDialog";
import { ExportThemeDialog } from "./ExportThemeDialog";

const TOOLBAR_BTN =
  "flex items-center gap-1.5 rounded-[6px] border border-line bg-surface2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-muted2 transition-colors hover:text-ink";

const ACTION_BTN =
  "rounded-[6px] border border-line bg-surface2 px-2.5 py-1.5 text-[10px] font-semibold text-ink transition-colors hover:border-accent-line hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink";

/** The "Theme" accordion body: the installed-themes grid, the active theme's
 * detail strip, and the existing token customiser tucked behind "Customize
 * tokens" so the section doesn't open with every control visible at once.
 *
 * Dev Mode is owned by the shell rather than this section: the inspector has
 * to survive closing Settings to reach the slots outside it, and it is
 * deliberately session-only. */
export function ThemesSection({
  devMode,
  onDevModeChange,
}: {
  devMode: boolean;
  onDevModeChange: (on: boolean) => void;
}) {
  const activeId = useThemeStore((s) => s.activeId);
  const installedThemes = useThemeStore((s) => s.installedThemes);
  const themeFiles = useThemeStore((s) => s.themeFiles);
  const pickTheme = useThemeStore((s) => s.pickTheme);
  const duplicateTheme = useThemeStore((s) => s.duplicateTheme);
  const deleteTheme = useThemeStore((s) => s.deleteTheme);

  const [importOpen, setImportOpen] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);
  const [customiserOpen, setCustomiserOpen] = useState(false);

  const installed = activeInstalled(activeId, installedThemes);
  const preset = activePreset(activeId);
  const activeName = installed?.name ?? preset?.name ?? "Neutral";
  const dark = resolvedPair(activeId, themeFiles).dark;

  function handleNewTheme() {
    const names = [...PRESETS.map((p) => p.name), ...installedThemes.map((t) => t.name)];
    void duplicateTheme("neutral", nextDuplicateName("New Theme", names));
    setCustomiserOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted2">
          Installed themes
        </span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setImportOpen(true)} className={TOOLBAR_BTN}>
            <Upload className="size-3" />
            Import…
          </button>
          <button type="button" onClick={handleNewTheme} className={TOOLBAR_BTN}>
            <Plus className="size-3" />
            New theme
          </button>
        </div>
      </div>

      <ThemeGrid
        activeId={activeId}
        installedThemes={installedThemes}
        themeFiles={themeFiles}
        onActivate={(id) => void pickTheme(id)}
        onDuplicate={(sourceId, name) => void duplicateTheme(sourceId, name)}
        onExport={(id) => setExportId(id)}
        onDelete={(id) => void deleteTheme(id)}
      />

      <div className="rounded-[8px] border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-success ring-2 ring-success-soft"
          />
          <strong className="text-[12px] text-ink">{activeName}</strong>
          {installed && (
            <span className="font-mono-data text-[10px] text-muted">
              v{installed.version} · {installed.tier}
            </span>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setCustomiserOpen((o) => !o)} className={ACTION_BTN}>
            {customiserOpen ? "Hide customiser" : "Customize tokens"}
          </button>
          <button type="button" disabled title="Coming in a later release" className={ACTION_BTN}>
            Edit layout
          </button>
          <button type="button" disabled title="Coming in a later release" className={ACTION_BTN}>
            Theme settings
          </button>
          <button
            type="button"
            onClick={() => onDevModeChange(!devMode)}
            aria-pressed={devMode}
            title="Outline the slots and elements a theme can reach"
            className={cn(ACTION_BTN, devMode && "border-accent-line text-accent")}
          >
            Dev Mode: {devMode ? "On" : "Off"}
          </button>
          <button
            type="button"
            onClick={() => void pickTheme("neutral")}
            disabled={activeId === "neutral"}
            className={cn(
              ACTION_BTN,
              "ml-auto border-danger-line bg-danger-soft text-danger hover:border-danger-line hover:text-danger",
            )}
          >
            Reset to Default
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-1.5 border-t border-line-weak pt-2.5">
          <span className="mr-auto text-[9px] text-muted">preview</span>
          {(["bg", "surface", "accent", "text"] as const).map((t) => (
            <span
              key={t}
              className="size-[14px] rounded-[4px] ring-1 ring-line"
              style={{ background: dark[t] }}
            />
          ))}
        </div>
      </div>

      {customiserOpen && <ThemeCustomiser />}

      {importOpen && (
        <ImportThemeDialog
          installedThemes={installedThemes}
          onInstalled={(id) => {
            setImportOpen(false);
            void pickTheme(id);
          }}
          onClose={() => setImportOpen(false)}
        />
      )}

      {exportId && (
        <ExportThemeDialog
          id={exportId}
          onExported={() => setExportId(null)}
          onClose={() => setExportId(null)}
        />
      )}
    </div>
  );
}
