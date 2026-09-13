import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useThemeStore,
  activePreset,
  activeInstalled,
  effective,
  effectiveExtras,
  resolvedPair,
} from "@/theme/theme-store";
import {
  GROUP_DEF,
  PRESETS,
  type Radii,
  type Spacing,
  type Typography,
} from "@/theme/palette";

const SPACING_ROWS: { key: keyof Spacing; label: string }[] = [
  { key: "xs", label: "Extra small" },
  { key: "sm", label: "Small" },
  { key: "md", label: "Medium" },
  { key: "lg", label: "Large" },
];

const RADII_ROWS: { key: keyof Radii; label: string }[] = [
  { key: "control", label: "Control" },
  { key: "row", label: "Row" },
  { key: "chip", label: "Chip" },
  { key: "pill", label: "Pill" },
];

const TYPOGRAPHY_ROWS: { key: keyof Typography; label: string }[] = [
  { key: "uiFont", label: "UI font" },
  { key: "dataFont", label: "Data font" },
];

/** Raw CSS length/font-family value, same posture as the colour hex readout. */
const EXTRAS_INPUT_CLASS =
  "min-w-0 flex-1 rounded-[5px] border border-line bg-surface px-1.5 py-[3px] text-right font-mono-data text-[9px] text-ink outline-none transition-colors focus:border-accent-line";

// Theme accordion body. Owns only local dropdown/save-input state — every
// colour decision writes straight to the theme store.
export function ThemeCustomiser() {
  const scheme = useThemeStore((s) => s.scheme);
  const activeId = useThemeStore((s) => s.activeId);
  const custom = useThemeStore((s) => s.custom);
  const customExtras = useThemeStore((s) => s.customExtras);
  const lightRefined = useThemeStore((s) => s.lightRefined);
  const bloom = useThemeStore((s) => s.bloom);
  const myThemes = useThemeStore((s) => s.installedThemes);
  const themeFiles = useThemeStore((s) => s.themeFiles);
  const setScheme = useThemeStore((s) => s.setScheme);
  const pickTheme = useThemeStore((s) => s.pickTheme);
  const setBloom = useThemeStore((s) => s.setBloom);
  const setColorOverride = useThemeStore((s) => s.setColorOverride);
  const setSpacingOverride = useThemeStore((s) => s.setSpacingOverride);
  const setRadiusOverride = useThemeStore((s) => s.setRadiusOverride);
  const setTypographyOverride = useThemeStore((s) => s.setTypographyOverride);
  const saveTheme = useThemeStore((s) => s.saveTheme);
  const deleteTheme = useThemeStore((s) => s.deleteTheme);
  const resetToBase = useThemeStore((s) => s.resetToBase);

  const [dropOpen, setDropOpen] = useState(false);
  const [name, setName] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);

  const pair = resolvedPair(activeId, themeFiles);
  const palette = effective(scheme, activeId, themeFiles, custom);
  const extras = effectiveExtras(activeId, themeFiles, customExtras);
  const saved = activeInstalled(activeId, myThemes);
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
              "kn pointer-events-none absolute left-[2px] top-[2px] h-4 w-4 rounded-full transition-transform duration-150",
              isDark ? "translate-x-[18px] bg-[#10131a]" : "translate-x-0 bg-muted2",
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
                  void pickTheme(p.id);
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
                    key={t.id}
                    className={cn(
                      "theme-item flex w-full items-center gap-2 px-2.5 py-[7px] transition-colors hover:bg-surface",
                      saved?.id === t.id && "bg-accent-soft",
                    )}
                  >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={saved?.id === t.id}
                    onClick={() => {
                      void pickTheme(t.id);
                      setDropOpen(false);
                      }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[11px] font-semibold text-muted2 hover:text-ink"
                    >
                    <span className="chips inline-flex shrink-0 gap-0.5">
                      <i
                        className="h-2 w-2 rounded-[2px]"
                        style={{ background: resolvedPair(t.id, themeFiles).dark.accent }}
                      />
                      <i
                        className="h-2 w-2 rounded-[2px]"
                        style={{ background: resolvedPair(t.id, themeFiles).dark.accent2 }}
                      />
                    </span>
                    <span className="nm min-w-0 flex-1 truncate">{t.name}</span>
                  </button>
                  <button
                    type="button"
                      aria-label={`Delete theme ${t.name}`}
                      onClick={() => void deleteTheme(t.id)}
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

      <div className="sec-h-sub mt-3.5 flex items-baseline gap-2">
        <h3 className="m-0 text-[9px] font-bold uppercase tracking-[0.07em] text-ink">
          Layout &amp; type
        </h3>
        <span className="text-[8px] text-muted">
          Raw CSS values · presets keep the defaults
        </span>
      </div>

      {/* Spacing and radii sit together; font stacks are long, so typography
          gets the full width beneath them. */}
      <div className="extras mt-2 grid grid-cols-2 gap-2">
        <ExtrasCard
          name="Spacing"
          rows={SPACING_ROWS}
          values={extras.spacing}
          onChange={setSpacingOverride}
        />
        <ExtrasCard
          name="Radii"
          rows={RADII_ROWS}
          values={extras.radii}
          onChange={setRadiusOverride}
        />
        <div className="col-span-2">
          <ExtrasCard
            name="Typography"
            rows={TYPOGRAPHY_ROWS}
            values={extras.typography}
            onChange={setTypographyOverride}
          />
        </div>
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
              void saveTheme(name.trim() || "Untitled theme");
              setName("");
            }
          }}
          className="min-w-0 flex-1 rounded-[6px] border border-line bg-bg px-2.5 py-[7px] font-ui text-[11px] text-ink placeholder-muted outline-none transition-colors focus:border-accent-line"
        />
        <button
          type="button"
          onClick={() => {
            void saveTheme(name.trim() || "Untitled theme");
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
          Clears colour, spacing, radius and font overrides back to the active theme&apos;s
          defaults.
        </span>
      </div>
    </>
  );
}

/**
 * One extras group: a heading and label/input rows, mirroring the colour
 * group cards. Values are raw CSS strings, written straight back to the store.
 */
function ExtrasCard<K extends string>({
  name,
  rows,
  values,
  onChange,
}: {
  name: string;
  rows: { key: K; label: string }[];
  values: Record<K, string>;
  onChange: (key: K, value: string) => void;
}) {
  return (
    <div className="group rounded-[7px] border border-line bg-bg px-2.5 py-2">
      <h4 className="m-0 mb-[7px] text-[8px] font-bold uppercase tracking-[0.06em] text-muted">
        {name}
      </h4>
      {rows.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between gap-1.5 py-[3px]">
          <label htmlFor={`extras-${name}-${key}`} className="shrink-0 text-[9px] text-muted2">
            {label}
          </label>
          <input
            id={`extras-${name}-${key}`}
            type="text"
            value={values[key]}
            onChange={(e) => onChange(key, e.target.value)}
            spellCheck={false}
            className={EXTRAS_INPUT_CLASS}
          />
        </div>
      ))}
    </div>
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
