import { useMemo, useState } from "react";
import { Upload, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { listStarterTemplates, scaffoldThemeFromTemplate } from "@/lib/tauri";
import type { ThemeSummary } from "@/types/theme";
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
import { newThemeRequest, byTier } from "./new-theme";
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
  layoutEditMode,
  onLayoutEditModeChange,
}: {
  devMode: boolean;
  onDevModeChange: (on: boolean) => void;
  layoutEditMode: boolean;
  onLayoutEditModeChange: (on: boolean) => void;
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
  /** `null` while the picker is closed. Its list starts empty and fills on open. */
  const [templates, setTemplates] = useState<ThemeSummary[] | null>(null);

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

  /** Names a new theme must avoid: the built-in presets and everything installed. */
  function takenNames(): string[] {
    return [...PRESETS.map((p) => p.name), ...installedThemes.map((t) => t.name)];
  }

  async function createFromTemplate(templateId: string, templateName: string) {
    // Taken from the template's own name, the way a duplicate is named after its
    // source, so a scaffolded theme reads as a copy of what it started from.
    const name = nextDuplicateName(templateName, takenNames());
    const request = newThemeRequest(templateId, name, templates ?? []);
    if (request === null || request.kind !== "template") return;

    setTemplates(null);
    try {
      await scaffoldThemeFromTemplate(
        request.templateId,
        request.newId,
        request.name,
      );
    } catch (e) {
      console.error(`Could not create a theme from "${templateName}":`, e);
      return;
    }
    // `pickTheme` re-reads the installed list for an id it has never seen, which
    // is exactly this theme; it also arms the same activation window as any pick.
    setCustomiserOpen(true);
    await pickTheme(request.newId, true);
  }

  async function handleNewTheme() {
    if (templates !== null) {
      setTemplates(null);
      return;
    }
    try {
      setTemplates(await listStarterTemplates());
    } catch (e) {
      // Blank still needs to work with no templates at all, so this opens the
      // picker empty rather than failing the button.
      console.error("Could not list the bundled starter templates:", e);
      setTemplates([]);
    }
  }

  function handleBlankTheme() {
    setTemplates(null);
    void duplicateTheme("neutral", nextDuplicateName("New Theme", takenNames()));
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
          <button
            type="button"
            onClick={() => void handleNewTheme()}
            aria-expanded={templates !== null}
            className={cn(TOOLBAR_BTN, templates !== null && "border-accent-line text-accent")}
          >
            <Plus className="size-3" />
            New theme
          </button>
        </div>
      </div>

      {templates !== null && (
        <div className="rounded-[8px] border border-line bg-surface2 p-2.5">
          <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted2">
            Start from
          </div>
          <div className="flex flex-wrap gap-1.5">
            {/* Today's behaviour, unchanged — now one choice rather than the only one. */}
            <button type="button" onClick={handleBlankTheme} className={ACTION_BTN}>
              Blank (copy Neutral)
            </button>
            {byTier(templates).map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => void createFromTemplate(template.id, template.name)}
                title={template.description}
                className={ACTION_BTN}
              >
                {template.name}
                <span className="ml-1.5 font-mono-data text-[9px] normal-case text-muted">
                  {template.tier}
                </span>
              </button>
            ))}
            {templates.length === 0 && (
              <span className="self-center text-[10px] text-muted">
                No starter templates ship with this build.
              </span>
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
          <button
            type="button"
            onClick={() => onLayoutEditModeChange(!layoutEditMode)}
            disabled={!devMode}
            title={devMode ? "Reorder and hide the active theme's slot children" : "Turn on Dev Mode to edit layout"}
            className={cn(ACTION_BTN, layoutEditMode && "border-accent-line text-accent")}
          >
            {layoutEditMode ? "Hide layout editor" : "Edit layout"}
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
