import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useThemeStore,
  activePreset,
  activeSaved,
  effective,
  resolvedPair,
} from "@/theme/theme-store";
import { GROUP_DEF, PRESETS } from "@/theme/palette";

/**
 * The Theme accordion body (board `.sec` for theme). Owns nothing but local
 * dropdown/save-input state; every colour decision writes straight to the
 * theme store, which repaints `<html>` via `applyTheme()` and re-renders this
 * component through its subscriptions.
 *
 * Sections, in board order: dark-mode switch, theme dropdown (Built-in +
 * Your themes with per-item delete), bloom slider, colour swatch groups with
 * the live mode hint, save row, reset row.
 */
export function ThemeCustomiser() {
  const scheme = useThemeStore((s) => s.scheme);
  const activeId = useThemeStore((s) => s.activeId);
  const custom = useThemeStore((s) => s.custom);
  const lightRefined = useThemeStore((s) => s.lightRefined);
  const bloom = useThemeStore((s) => s.bloom);
  const myThemes = useThemeStore((s) => s.myThemes);
  const setScheme = useThemeStore((s) => s.setScheme);
  const pickTheme = useThemeStore((s) => s.pickTheme);
  const setBloom = useThemeStore((s) => s.setBloom);
  const setColorOverride = useThemeStore((s) => s.setColorOverride);
  const saveTheme = useThemeStore((s) => s.saveTheme);
  const deleteTheme = useThemeStore((s) => s.deleteTheme);
  const resetToBase = useThemeStore((s) => s.resetToBase);

  const [dropOpen, setDropOpen] = useState(false);
  const [name, setName] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  const pair = resolvedPair(activeId, myThemes);
  const palette = effective(scheme, activeId, myThemes, custom);
  const saved = activeSaved(activeId, myThemes);
  const displayName = saved?.name ?? activePreset(activeId)?.name ?? "Neutral";

  // Outside mousedown closes the theme dropdown (same pattern as the filter
  // bar popovers).
  function closeOnOutside(e: MouseEvent) {
    if (!dropRef.current?.contains(e.target as Node)) setDropOpen(false);
  }
  useOutsideClick(dropOpen, closeOnOutside);

  const isDark = scheme === "dark";

  return (
    <>
      {/* Dark mode switch — bound to the active theme's scheme. */}
      <div className="switch-row flex items-center justify-between gap-3">
        <div className="lb">
          <b className="block text-[11px] font-semibold text-ink">Dark mode</b>
          <span className="mt-0.5 block text-[9px] leading-[1.4] text-muted">
            Toggle the active theme&apos;s palette pair. Never a dead toggle — every theme has
            both.
          </span>
        </div>
        <label className="switch relative inline-flex h-5 w-[38px] shrink-0">
          <input
            type="checkbox"
            checked={isDark}
            onChange={(e) => setScheme(e.target.checked ? "dark" : "light")}
            aria-label="Dark mode"
            className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span
            className={cn(
              "tr pointer-events-none absolute inset-0 rounded-full transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-line",
              isDark ? "bg-accent shadow-[var(--glow)]" : "bg-line",
            )}
          />
          <span
            className={cn(
              "kn pointer-events-none absolute top-[2px] h-4 w-4 rounded-full transition-[left] duration-150",
              isDark ? "left-5 bg-[#10131a]" : "left-[2px] bg-muted2",
            )}
          />
        </label>
      </div>

      <div className="sec-h-sub mt-3.5 flex items-baseline gap-2">
        <h3 className="m-0 text-[9px] font-bold uppercase tracking-[0.07em] text-ink">Theme</h3>
        <span className="text-[8px] text-muted">Presets + your saved skins</span>
      </div>

      {/* Theme dropdown */}
      <div className="theme-drop relative" ref={dropRef}>
        <button
          type="button"
          onClick={() => setDropOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={dropOpen}
          className="theme-trigger flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[7px] border border-line bg-surface px-2.5 py-2 text-left text-[11px] font-semibold text-ink transition-colors hover:border-accent-line"
        >
          <span className="chips inline-flex shrink-0 gap-0.5">
            <i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: pair.dark.accent }} />
            <i className="h-2.5 w-2.5 rounded-[2px]" style={{ background: pair.dark.accent2 }} />
          </span>
          <span className="nm min-w-0 flex-1 truncate">{displayName}</span>
          <span
            className={cn(
              "chev flex shrink-0 text-muted transition-transform duration-150",
              dropOpen && "rotate-180",
            )}
          >
            <ChevronDown className="h-3 w-3" />
          </span>
        </button>

        {dropOpen && (
          <div className="theme-menu absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[280px] overflow-auto rounded-[8px] border border-line bg-surface2 shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
            <div className="theme-group px-2.5 pb-1 pt-[7px] text-[8px] font-bold uppercase tracking-[0.05em] text-muted">
              Built-in
            </div>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={activeId === p.id}
                onClick={() => {
                  pickTheme(p.id);
                  setDropOpen(false);
                }}
                className={cn(
                  "theme-item flex w-full cursor-pointer items-center gap-2 px-2.5 py-[7px] text-left text-[11px] font-semibold text-muted2 transition-colors hover:bg-surface hover:text-ink",
                  activeId === p.id && "bg-accent-soft text-accent",
                )}
              >
                <span className="chips inline-flex shrink-0 gap-0.5">
                  <i className="h-2 w-2 rounded-[2px]" style={{ background: p.dark.accent }} />
                  <i className="h-2 w-2 rounded-[2px]" style={{ background: p.dark.accent2 }} />
                </span>
                <span className="nm min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            ))}
            {myThemes.length > 0 && (
              <>
                <div className="theme-group px-2.5 pb-1 pt-[7px] text-[8px] font-bold uppercase tracking-[0.05em] text-muted">
                  Your themes
                </div>
                {myThemes.map((t) => (
                  <div
                    key={t.name}
                    className={cn(
                      "theme-item flex w-full items-center gap-2 px-2.5 py-[7px] transition-colors hover:bg-surface",
                      saved?.name === t.name && "bg-accent-soft",
                    )}
                  >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={saved?.name === t.name}
                    onClick={() => {
                      pickTheme(`custom:${t.name}`);
                      setDropOpen(false);
                      }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[11px] font-semibold text-muted2 hover:text-ink"
                    >
                    <span className="chips inline-flex shrink-0 gap-0.5">
                      <i className="h-2 w-2 rounded-[2px]" style={{ background: t.dark.accent }} />
                      <i className="h-2 w-2 rounded-[2px]" style={{ background: t.dark.accent2 }} />
                    </span>
                    <span className="nm min-w-0 flex-1 truncate">{t.name}</span>
                  </button>
                  <button
                    type="button"
                      aria-label={`Delete theme ${t.name}`}
                      onClick={() => deleteTheme(t.name)}
                      className="cd shrink-0 cursor-pointer px-1 text-[8px] text-muted transition-colors hover:text-danger"
                    >
                      ✕
                  </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bloom */}
      <div className="bloom-row mt-2 flex items-center gap-2 rounded-[7px] border border-line bg-bg px-2.5 py-[7px]">
        <label htmlFor="bloom-range" className="w-11 shrink-0 text-[9px] font-semibold text-ink">
          Bloom
        </label>
        <input
          id="bloom-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={bloom}
          onChange={(e) => setBloom(Number(e.target.value))}
          className="h-[3px] flex-1 accent-accent"
        />
        <output className="w-[30px] shrink-0 text-right font-mono-data text-[9px] text-accent">
          {Math.round(bloom * 100)}%
        </output>
      </div>

      <div className="sec-h-sub mt-3.5 flex items-baseline gap-2">
        <h3 className="m-0 text-[9px] font-bold uppercase tracking-[0.07em] text-ink">
          Customise colours
        </h3>
        <span className="text-[8px] text-muted">
          Editing {isDark ? "dark" : "light"} palette
          {lightRefined
            ? " (hand-edited)"
            : isDark
              ? " — light auto-derives"
              : ""}
          {" · 4.5:1 floor"}
        </span>
      </div>

      <div className="groups mt-2 grid grid-cols-2 gap-2">
        {GROUP_DEF.map((g) => (
          <div key={g.name} className="group rounded-[7px] border border-line bg-bg px-2.5 py-2">
            <h4 className="m-0 mb-[7px] text-[8px] font-bold uppercase tracking-[0.06em] text-muted">
              {g.name}
            </h4>
            {g.keys.map((token) => (
              <div key={token} className="swatch flex items-center justify-between gap-1.5 py-[3px]">
                <label htmlFor={`swatch-${token}`} className="text-[9px] text-muted2">
                  {g.labels[token]}
                </label>
                <span className="ctl flex items-center gap-1">
                  <input
                    id={`swatch-${token}`}
                    type="color"
                    value={palette[token]}
                    onChange={(e) => setColorOverride(token, e.target.value)}
                    className="h-[19px] w-[19px] cursor-pointer rounded-[5px] border border-line bg-transparent p-0"
                  />
                  <span className="val font-mono-data text-[8px] text-muted">{palette[token]}</span>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mode-note mt-1.5 text-[9px] text-muted">
        {isDark
          ? "Editing dark re-derives the light pair until you hand-edit light."
          : "Editing light directly — it overrides the auto-derived pair."}
      </div>

      <div className="save-row mt-2 flex gap-[7px]">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name your theme…"
          maxLength={28}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              saveTheme(name.trim() || "Untitled theme");
              setName("");
            }
          }}
          className="min-w-0 flex-1 rounded-[6px] border border-line bg-bg px-2.5 py-[7px] font-ui text-[11px] text-ink placeholder-muted outline-none transition-colors focus:border-accent-line"
        />
        <button
          type="button"
          onClick={() => {
            saveTheme(name.trim() || "Untitled theme");
            setName("");
          }}
          className="shrink-0 rounded-[6px] border-none bg-accent px-3 py-[7px] text-[10px] font-bold uppercase tracking-[0.05em] text-[#10131a] shadow-[var(--glow)] transition-[filter] hover:brightness-110"
        >
          Save theme
        </button>
      </div>

      <div className="reset-row mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={resetToBase}
          className="rounded-[6px] border border-line bg-surface2 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.04em] text-muted2 transition-colors hover:text-ink"
        >
          Reset to base
        </button>
        <span className="text-[8px] leading-[1.4] text-muted">
          Clears colour overrides back to the active mode&apos;s default.
        </span>
      </div>
    </>
  );
}

/** Bind a document-level mousedown listener while `open`; fires `onOutside`. */
function useOutsideClick(open: boolean, onOutside: (e: MouseEvent) => void) {
  useEffect(() => {
    if (!open) return;
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open, onOutside]);
}
