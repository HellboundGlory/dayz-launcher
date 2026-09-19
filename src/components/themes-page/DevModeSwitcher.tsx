import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/theme/theme-store";
import { useDevStore } from "@/theme/dev/dev-store";
import { resolveSettingsSchema } from "@/theme/settings-schema";
import { settingsCombinations } from "@/theme/dev/combinations";
import { NEUTRAL_LAYOUTS } from "@/theme/neutral/index";
import type { LayoutFile } from "@/theme/renderer/types";

// 650 is the narrowest CSS width the launcher allows; 1400 is the harness's
// wide size (SPEC §18).
const FIXED_WIDTHS = [650, 975, 1400];

function minWidthsOf(file: LayoutFile): number[] {
  return (file.variants ?? [])
    .map((v) => v.minWidth)
    .filter((w): w is number => typeof w === "number");
}

/** The active theme's own `layout.json` is untrusted JSON — read defensively. */
function untrustedMinWidths(layout: unknown): number[] {
  if (typeof layout !== "object" || layout === null) return [];
  const variants = (layout as { variants?: unknown }).variants;
  if (!Array.isArray(variants)) return [];
  const widths: number[] = [];
  for (const variant of variants) {
    const minWidth = (variant as { minWidth?: unknown } | null)?.minWidth;
    if (typeof minWidth === "number") widths.push(minWidth);
  }
  return widths;
}

export interface DevModeSwitcherViewProps {
  widths: number[];
  activeWidth: number | null;
  combinations: { label: string }[];
  activeCombination: string | null;
  capped: boolean;
  settingsAvailable: boolean;
  /** Why the Variant row can't do anything, or null when the width chips are live. */
  variantInertReason: string | null;
  onPickWidth: (width: number | null) => void;
  onPickCombination: (label: string | null) => void;
}

function chipClass(active: boolean): string {
  return cn(
    "shrink-0 [border-radius:var(--t-radius-chip)] border px-1.5 py-px [font-size:var(--t-type-compactCaption-size)] uppercase tracking-[0.04em]",
    active
      ? "[border-color:rgb(255,79,216)] bg-[rgba(255,79,216,0.2)] [color:rgb(255,154,232)]"
      : "[border-color:rgb(255,79,216)] [color:rgb(255,154,232)] hover:bg-[rgba(255,79,216,0.2)]",
  );
}

/** Pure markup for the variant/settings switcher — no store reads. */
export function DevModeSwitcherView({
  widths,
  activeWidth,
  combinations,
  activeCombination,
  capped,
  settingsAvailable,
  variantInertReason,
  onPickWidth,
  onPickCombination,
}: DevModeSwitcherViewProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-1">
        <div className="uppercase tracking-[0.04em] [color:rgb(156,147,173)]">Variant</div>
        {variantInertReason !== null ? (
          <div className="[color:rgb(156,147,173)]">{variantInertReason}</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              aria-pressed={activeWidth === null}
              onClick={() => onPickWidth(null)}
              className={chipClass(activeWidth === null)}
            >
              Real width
            </button>
            {widths.map((width) => (
              <button
                key={width}
                type="button"
                aria-pressed={activeWidth === width}
                onClick={() => onPickWidth(width)}
                className={chipClass(activeWidth === width)}
              >
                {width}px
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="uppercase tracking-[0.04em] [color:rgb(156,147,173)]">Settings</div>
        {settingsAvailable ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              aria-pressed={activeCombination === null}
              onClick={() => onPickCombination(null)}
              className={chipClass(activeCombination === null)}
            >
              Theme&apos;s own values
            </button>
            {combinations.map((combination) => (
              <button
                key={combination.label}
                type="button"
                aria-pressed={activeCombination === combination.label}
                onClick={() => onPickCombination(combination.label)}
                className={chipClass(activeCombination === combination.label)}
              >
                {combination.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="[color:rgb(156,147,173)]">No theme settings</div>
        )}
        {capped && <div className="[color:rgb(156,147,173)]">Showing the first 64 combinations</div>}
      </div>
    </div>
  );
}

/** Mounted inside the validation panel: derives the width/combination
 * choices from the active theme and drives the dev store's overrides. */
export function DevModeSwitcher() {
  const activeId = useThemeStore((s) => s.activeId);
  const themeFiles = useThemeStore((s) => s.themeFiles);
  const setVariantWidth = useDevStore((s) => s.setVariantWidth);
  const setSettingsOverride = useDevStore((s) => s.setSettingsOverride);
  const activeWidth = useDevStore((s) => s.variantWidth) ?? useDevStore.getState().variantWidth;
  const settingsOverride =
    useDevStore((s) => s.settingsOverride) ?? useDevStore.getState().settingsOverride;
  const activeRenderers = useDevStore((s) => s.activeRenderers);

  // The label of the combination this component last dispatched — matched
  // against rather than deep-comparing the store's values map.
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);

  const activeFile = themeFiles[activeId];

  const declaredMinWidths = (() => {
    const set = new Set<number>();
    for (const file of Object.values(NEUTRAL_LAYOUTS)) {
      for (const width of minWidthsOf(file)) set.add(width);
    }
    for (const width of untrustedMinWidths(activeFile?.layout)) set.add(width);
    return set;
  })();

  const widths = [...new Set<number>([...FIXED_WIDTHS, ...declaredMinWidths])].sort((a, b) => a - b);

  const variantInertReason =
    activeRenderers === 0
      ? "No screen renders from a layout file yet"
      : declaredMinWidths.size === 0
        ? "No variants declared"
        : null;

  const { fields } = resolveSettingsSchema(activeFile?.settingsSchema);
  const { combinations, capped } = settingsCombinations(fields);
  const settingsAvailable = fields.length > 0;
  const activeCombination = settingsOverride === null ? null : pickedLabel;

  const handlePickWidth = useCallback(
    (width: number | null) => setVariantWidth(width),
    [setVariantWidth],
  );

  const handlePickCombination = useCallback(
    (label: string | null) => {
      if (label === null) {
        setSettingsOverride(null);
        setPickedLabel(null);
      } else {
        const found = combinations.find((c) => c.label === label);
        setSettingsOverride(found?.values ?? null);
        setPickedLabel(label);
      }
      useThemeStore.getState().apply();
    },
    [combinations, setSettingsOverride],
  );

  return (
    <DevModeSwitcherView
      widths={widths}
      activeWidth={activeWidth}
      combinations={combinations.map((c) => ({ label: c.label }))}
      activeCombination={activeCombination}
      capped={capped}
      settingsAvailable={settingsAvailable}
      variantInertReason={variantInertReason}
      onPickWidth={handlePickWidth}
      onPickCombination={handlePickCombination}
    />
  );
}
