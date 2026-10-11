import { useState } from "react";
import { PRESETS } from "@/theme/palette";
import { resolveThemeAsset } from "@/theme/asset-resolver";
import { deleteThemeMessage, resolvedPair } from "@/theme/theme-store";
import { useConfirm } from "@/components/confirm-dialog";
import type { ThemeFile, ThemeSummary } from "@/types/theme";
import { ThemeCard } from "./ThemeCard";
import { Pagination } from "./Pagination";

export interface GridEntry {
  id: string;
  name: string;
  builtin: boolean;
  author?: string;
  version?: string;
  /** The manifest's own relative preview path; absent for built-ins. */
  preview?: string;
  /** True when the backend's scan flagged this theme's schema/API as unsupported. */
  incompatible?: boolean;
  incompatibleReason?: string;
}

interface ThemeGridProps {
  activeId: string;
  installedThemes: ThemeSummary[];
  themeFiles: Record<string, ThemeFile>;
  onActivate: (id: string) => void;
  onDuplicate: (sourceId: string, newName: string) => void;
  onExport: (id: string) => void;
  /** Called only once the in-app confirm dialog is accepted. */
  onDelete: (id: string) => void;
}

const PER_PAGE = 4;

// Bundled by the backend at every launch; page-1 display order is this order.
const BUILTIN_SHOWCASE_IDS = ["builtin.tactical"] as const;
const IS_SHOWCASE = Object.fromEntries(
  BUILTIN_SHOWCASE_IDS.map((id) => [id, true as const]),
) as Record<string, true>;

/** The grid card's image: the first `previews` entry, falling back to v1's single `preview`. */
function gridPreview(t: ThemeSummary): string | undefined {
  return t.previews?.[0]?.file ?? t.preview ?? undefined;
}

/** Neutral, then the showcase themes in fixed order, then installed themes. */
export function buildGridEntries(installedThemes: ThemeSummary[]): GridEntry[] {
  const showcase = BUILTIN_SHOWCASE_IDS.flatMap((id) => {
    const t = installedThemes.find((theme) => theme.id === id);
    return t
      ? [{
          id: t.id,
          name: t.name,
          builtin: true,
          author: t.author,
          version: t.version,
          preview: gridPreview(t),
          incompatible: t.incompatible,
          incompatibleReason: t.incompatibleReason ?? undefined,
        }]
      : [];
  });
  const rest = installedThemes.filter((t) => !(t.id in IS_SHOWCASE));
  return [
    ...PRESETS.map((p) => ({ id: p.id, name: p.name, builtin: true })),
    ...showcase,
    ...rest.map((t) => ({
      id: t.id,
      name: t.name,
      builtin: false,
      author: t.author,
      version: t.version,
      preview: gridPreview(t),
      incompatible: t.incompatible,
      incompatibleReason: t.incompatibleReason ?? undefined,
    })),
  ];
}

/**
 * `${baseName} copy`, then `… copy 2`, `… copy 3`, … — the first candidate
 * whose name is not taken, compared trimmed and case-insensitively as
 * `newThemeId` compares them. Also used by the Settings "New theme" flow, so
 * it's exported.
 */
export function nextDuplicateName(baseName: string, existingNames: string[]): string {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  let candidate = `${baseName} copy`;
  let n = 2;
  while (taken.has(candidate.trim().toLowerCase())) candidate = `${baseName} copy ${n++}`;
  return candidate;
}

export function ThemeGrid({
  activeId,
  installedThemes,
  themeFiles,
  onActivate,
  onDuplicate,
  onExport,
  onDelete,
}: ThemeGridProps) {
  // Local page state on purpose — resets when the accordion section unmounts.
  const [page, setPage] = useState(0);
  const confirm = useConfirm();

  const entries = buildGridEntries(installedThemes);
  const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const clamped = Math.min(page, totalPages - 1);
  const visible = entries.slice(clamped * PER_PAGE, clamped * PER_PAGE + PER_PAGE);

  return (
    <div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
        {visible.map((entry) => {
          const dark = resolvedPair(entry.id, themeFiles).dark;
          const custom = !entry.builtin;
          return (
            <ThemeCard
              key={entry.id}
              name={entry.name}
              builtin={entry.builtin}
              author={entry.author}
              version={entry.version}
              active={entry.id === activeId}
              swatches={[dark.bg, dark.surface, dark.accent, dark.text]}
              previewUrl={entry.preview ? resolveThemeAsset(entry.id, entry.preview) : undefined}
              incompatible={entry.incompatible}
              incompatibleReason={entry.incompatibleReason}
              onActivate={entry.incompatible ? undefined : () => onActivate(entry.id)}
              onDuplicate={
                entry.incompatible
                  ? undefined
                  : () =>
                      onDuplicate(
                        entry.id,
                        nextDuplicateName(
                          entry.name,
                          entries.map((e) => e.name),
                        ),
                      )
              }
              onExport={custom && !entry.incompatible ? () => onExport(entry.id) : undefined}
              // The active theme can't delete itself out from under the launcher.
              onRequestDelete={
                custom && entry.id !== activeId
                  ? () =>
                      confirm(
                        "Delete theme",
                        deleteThemeMessage(entry.name),
                        () => onDelete(entry.id),
                      )
                  : undefined
              }
            />
          );
        })}
      </div>

      <Pagination
        page={clamped}
        totalPages={totalPages}
        totalCount={entries.length}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
      />
    </div>
  );
}
