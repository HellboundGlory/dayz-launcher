import { useMemo, useState } from "react";
import { Upload, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useThemeStore,
  activePreset,
  activeInstalled,
  resolvedPair,
} from "@/theme/theme-store";
import { resolveSettingsSchema } from "@/theme/settings-schema";
import { PRESETS } from "@/theme/palette";
import { ThemeCustomiser } from "../theme-customiser";
import { ThemeGrid, nextDuplicateName } from "./ThemeGrid";
import { ThemeSettingsForm } from "./ThemeSettingsForm";
import { ImportThemeDialog } from "./ImportThemeDialog";
import { ExportThemeDialog } from "./ExportThemeDialog";
import { capabilityLabel } from "./capability-labels";

const TOOLBAR_BTN =
  "flex items-center gap-1.5 [border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-1.5 [font-size:var(--t-type-label-size)] font-semibold uppercase tracking-[0.04em] text-muted2 transition-colors hover:text-ink";

const ACTION_BTN =
  "[border-radius:var(--t-radius-control)] border border-line bg-surface2 px-2.5 py-1.5 [font-size:var(--t-type-label-size)] font-semibold text-ink transition-colors hover:border-accent-line hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const installed = activeInstalled(activeId, installedThemes);
  const preset = activePreset(activeId);
  const activeName = installed?.name ?? preset?.name ?? "Neutral";
  const dark = resolvedPair(activeId, themeFiles).dark;
  // Only an installed theme can ship a schema; a preset or neutral resolves to
  // an empty list, which is exactly what leaves the button disabled.
  const settingsFields = useMemo(
    () => resolveSettingsSchema(themeFiles[activeId]?.settingsSchema).fields,
    [themeFiles, activeId],
  );

  /** Names a new theme must avoid: the presets, and every installed theme by name and by id. */
  function takenNames(): string[] {
    return [
      ...PRESETS.map((p) => p.name),
      ...installedThemes.flatMap((t) => [t.name, t.id.replace(/^local\./, "")]),
    ];
  }

  function copyTheme(sourceId: string) {
    setCopyOpen(false);
    void duplicateTheme(sourceId, nextDuplicateName("New Theme", takenNames()));
    setCustomiserOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="[font-size:var(--t-type-compactCaption-size)] font-bold uppercase tracking-wider text-muted2">
          Installed themes
        </span>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setImportOpen(true)} className={TOOLBAR_BTN}>
            <Upload className="size-3" />
            Import…
          </button>
          <button
            type="button"
            onClick={() => setCopyOpen((open) => !open)}
            aria-expanded={copyOpen}
            className={cn(TOOLBAR_BTN, copyOpen && "border-accent-line text-accent")}
          >
            <Plus className="size-3" />
            New theme
          </button>
        </div>
      </div>

      {copyOpen && (
        <div className="[border-radius:var(--t-radius-card)] border border-line bg-surface2 p-2.5">
          <div className="mb-1.5 [font-size:var(--t-type-compactCaption-size)] font-bold uppercase tracking-wider text-muted2">
            Start from
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => copyTheme("neutral")} className={ACTION_BTN}>
              Copy Neutral
            </button>
            {installedThemes.some((t) => t.id === "builtin.tactical") && (
              <button type="button" onClick={() => copyTheme("builtin.tactical")} className={ACTION_BTN}>
                Copy Tactical
              </button>
            )}
          </div>
        </div>
      )}

      <ThemeGrid
        activeId={activeId}
        installedThemes={installedThemes}
        themeFiles={themeFiles}
        onActivate={(id) => void pickTheme(id)}
        onDuplicate={(sourceId, name) => void duplicateTheme(sourceId, name)}
        onExport={(id) => setExportId(id)}
        onDelete={(id) => void deleteTheme(id)}
      />

      <div className="[border-radius:var(--t-radius-card)] border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-success ring-2 ring-success-soft"
          />
          <strong className="[font-size:var(--t-type-subheading-size)] text-ink">{activeName}</strong>
          {installed && (
            <span className="font-mono-data [font-size:var(--t-type-label-size)] text-muted">
              v{installed.version} · {capabilityLabel(installed.capabilities)}
            </span>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setCustomiserOpen((o) => !o)} className={ACTION_BTN}>
            {customiserOpen ? "Hide customiser" : "Customize tokens"}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            disabled={settingsFields.length === 0}
            title={settingsFields.length === 0 ? "Coming in a later release" : undefined}
            className={cn(ACTION_BTN, settingsOpen && "border-accent-line text-accent")}
          >
            {settingsOpen ? "Hide settings" : "Theme settings"}
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
          <span className="mr-auto [font-size:var(--t-type-caption-size)] text-muted">preview</span>
          {(["bg", "surface", "accent", "text"] as const).map((t) => (
            <span
              key={t}
              className="size-[14px] [border-radius:var(--t-radius-chip)] ring-1 ring-line"
              style={{ background: dark[t] }}
            />
          ))}
        </div>
      </div>

      {customiserOpen && <ThemeCustomiser />}

      {settingsOpen && settingsFields.length > 0 && (
        <ThemeSettingsForm id={activeId} fields={settingsFields} />
      )}

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
