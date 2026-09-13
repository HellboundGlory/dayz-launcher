import { useEffect, useRef, useState } from "react";
import { Copy, FileOutput, MoreHorizontal, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemeCardProps {
  name: string;
  builtin: boolean;
  author?: string;
  version?: string;
  active: boolean;
  swatches: [string, string, string, string];
  /** A resolved `tetra-theme://` URL (see `resolveThemeAsset`); absent when the theme declares no preview. */
  previewUrl?: string;
  onActivate: () => void;
  onDuplicate: () => void;
  /** Absent for a built-in theme — the menu item is omitted, not disabled. */
  onExport?: () => void;
  /** Absent for a built-in theme or the active theme. */
  onRequestDelete?: () => void;
}

// Same hook as theme-customiser.tsx's, kept local on purpose — too small to share.
function useOutsideClick(open: boolean, onOutside: (e: MouseEvent) => void) {
  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open, onOutside]);
}

export function ThemeCard({
  name,
  builtin,
  author,
  version,
  active,
  swatches,
  previewUrl,
  onActivate,
  onDuplicate,
  onExport,
  onRequestDelete,
}: ThemeCardProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  // A preview that fails (missing/stale file) falls back to the swatch strip,
  // which is why `swatches` stays required either way. Keyed by URL so a later
  // preview for the same card gets its own chance to load.
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The trigger toggles on click, so a mousedown inside it must not close.
  function closeOnOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
    setMenuOpen(false);
  }
  useOutsideClick(menuOpen, closeOnOutside);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-[8px] border bg-surface",
        active ? "border-accent-line" : "border-line",
      )}
    >
      {/* Live theme colours, so inline styles — the one place a hex is correct.
          Rounded + clipped on its own, not the card root, so the upward-opening
          overflow menu below isn't clipped by it too. */}
      <div className="flex h-9 overflow-hidden rounded-t-[7px]">
        {previewUrl && failedPreview !== previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            onError={() => setFailedPreview(previewUrl)}
            className="h-9 w-full rounded-t-[7px] object-cover"
          />
        ) : (
          swatches.map((color, i) => (
            <div key={i} className="flex-1" style={{ background: color }} />
          ))
        )}
      </div>

      <div className="flex flex-1 flex-col p-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {active && (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-success ring-2 ring-success-soft"
            />
          )}
          <p className="truncate text-[11px] font-bold text-ink" title={name}>
            {name}
          </p>
        </div>
        <p className="mt-0.5 truncate text-[9px] text-muted">
          {builtin ? "built-in" : `by ${author} · v${version}`}
        </p>

        <div className="relative mt-2.5 flex items-center gap-1.5">
          {!active && (
            <button
              type="button"
              onClick={onActivate}
              className="flex-1 rounded-[5px] border border-line bg-surface2 px-2 py-1 text-[10px] font-semibold text-ink transition-colors hover:border-accent-line hover:text-accent"
            >
              Activate
            </button>
          )}
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`${name} options`}
            className="inline-flex h-[22px] w-[26px] shrink-0 items-center justify-center rounded-[5px] border border-line bg-surface2 text-muted2 transition-colors hover:text-ink"
          >
            <MoreHorizontal className="size-3.5" />
          </button>

          {/* Opens upward: inside a settings panel there's rarely room below. */}
          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              className="absolute bottom-full right-0 z-20 mb-1 w-44 rounded-[7px] border border-line bg-surface2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
            >
              <MenuItem
                icon={Copy}
                label="Duplicate as new theme"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
              />
              {onExport && (
                <MenuItem
                  icon={FileOutput}
                  label="Export"
                  onClick={() => {
                    setMenuOpen(false);
                    onExport();
                  }}
                />
              )}
              {onRequestDelete && (
                <MenuItem
                  icon={Trash2}
                  destructive
                  label="Delete"
                  onClick={() => {
                    setMenuOpen(false);
                    onRequestDelete();
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left text-[11px] font-semibold transition-colors hover:bg-surface",
        destructive ? "text-danger" : "text-ink",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </button>
  );
}
