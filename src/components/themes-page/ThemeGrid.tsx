import { useEffect, useRef, useState } from "react";
import { PRESETS } from "@/theme/palette";
import { resolvedPair } from "@/theme/theme-store";
import type { ThemeFile, ThemeSummary } from "@/types/theme";
import { ThemeCard } from "./ThemeCard";
import { Pagination } from "./Pagination";

export interface GridEntry {
  id: string;
  name: string;
  builtin: boolean;
  author?: string;
  version?: string;
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

/**
 * `${baseName} copy`, then `… copy 2`, `… copy 3`, … — the first candidate not
 * already taken. Also used by the Settings "New theme" flow, so it's exported.
 */
export function nextDuplicateName(baseName: string, existingNames: string[]): string {
  let candidate = `${baseName} copy`;
  let n = 2;
  while (existingNames.includes(candidate)) candidate = `${baseName} copy ${n++}`;
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
}: ThemeGridProps): JSX.Element {
  // Local page state on purpose — resets when the accordion section unmounts.
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<{
    id: string;
    title: string;
    message: string;
  } | null>(null);
  const confirmWrapRef = useRef<HTMLDivElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);

  const entries: GridEntry[] = [
    ...PRESETS.map((p) => ({ id: p.id, name: p.name, builtin: true })),
    ...installedThemes.map((t) => ({
      id: t.id,
      name: t.name,
      builtin: false,
      author: t.author,
      version: t.version,
    })),
  ];

  const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const clamped = Math.min(page, totalPages - 1);
  const visible = entries.slice(clamped * PER_PAGE, clamped * PER_PAGE + PER_PAGE);

  // Focus Cancel by default (safer for a destructive action); Escape closes.
  useEffect(() => {
    if (!confirm) return;
    confirmCancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirm(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirm]);

  /** Tab wraps within the confirm dialog; Shift+Tab goes backwards. */
  function trapConfirmTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const els = Array.from(
      confirmWrapRef.current?.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((el) => !el.hasAttribute("disabled"));
    if (els.length === 0) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="relative">
      <div className="grid grid-cols-4 gap-2">
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
              onActivate={() => onActivate(entry.id)}
              onDuplicate={() =>
                onDuplicate(
                  entry.id,
                  nextDuplicateName(
                    entry.name,
                    entries.map((e) => e.name),
                  ),
                )
              }
              onExport={custom ? () => onExport(entry.id) : undefined}
              // The active theme can't delete itself out from under the launcher.
              onRequestDelete={
                custom && entry.id !== activeId
                  ? () =>
                      setConfirm({
                        id: entry.id,
                        title: "Delete theme",
                        message: `Delete “${entry.name}”? This removes its files from disk and can't be undone.`,
                      })
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

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setConfirm(null)}
        >
          <div
            ref={confirmWrapRef}
            role="dialog"
            aria-modal="true"
            aria-label={confirm.title}
            onKeyDown={trapConfirmTab}
            className="w-80 rounded-[8px] border border-line bg-surface p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-bold text-ink">{confirm.title}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted2">{confirm.message}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                ref={confirmCancelRef}
                onClick={() => setConfirm(null)}
                className="rounded-[6px] border border-line bg-surface2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted2 transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = confirm.id;
                  setConfirm(null);
                  onDelete(id);
                }}
                className="rounded-[6px] bg-danger px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#10131a] transition-colors hover:brightness-110"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
