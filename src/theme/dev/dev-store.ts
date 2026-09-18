import { create } from "zustand";
import { validateTheme } from "@/lib/tauri";
import type { ValidationIssue } from "@/types/theme";
import type { Palette } from "@/theme/palette";
import type { SettingsValue } from "@/theme/theme-store";
import { contrastIssues } from "./contrast";

export interface DevStore {
  /** Backend validator findings for the active theme. */
  issues: ValidationIssue[];
  /** Contrast findings for the active token set. */
  contrast: ValidationIssue[];
  refreshing: boolean;
  /** Why the last refresh could not run at all (e.g. the theme folder is gone). */
  error: string | null;
  /** Dev-only width used to pick a responsive root; null means the real window width. */
  variantWidth: number | null;
  /** Dev-only theme-settings values; null means the theme's own stored values. */
  settingsOverride: Record<string, SettingsValue> | null;

  refresh: (
    themeId: string,
    palette: Palette,
    roleColors: Record<string, string>,
    scheme: "dark" | "light",
  ) => Promise<void>;
  setVariantWidth: (width: number | null) => void;
  setSettingsOverride: (values: Record<string, SettingsValue> | null) => void;
  clear: () => void;
}

const INITIAL = {
  issues: [] as ValidationIssue[],
  contrast: [] as ValidationIssue[],
  refreshing: false,
  error: null as string | null,
  variantWidth: null as number | null,
  settingsOverride: null as Record<string, SettingsValue> | null,
};

// Guards against a slower earlier refresh overwriting a newer one's results.
let refreshSeq = 0;

export const useDevStore = create<DevStore>((set) => ({
  ...INITIAL,

  refresh: async (themeId, palette, roleColors, scheme) => {
    const seq = ++refreshSeq;
    set({ refreshing: true });
    const contrast = contrastIssues(palette, roleColors, scheme);
    try {
      const issues = await validateTheme(themeId);
      if (seq !== refreshSeq) return;
      set({ issues, contrast, error: null, refreshing: false });
    } catch (e) {
      if (seq !== refreshSeq) return;
      set({ issues: [], contrast, error: String(e), refreshing: false });
    }
  },

  setVariantWidth: (width) => set({ variantWidth: width }),

  setSettingsOverride: (values) => set({ settingsOverride: values }),

  clear: () => set({ ...INITIAL }),
}));

export function refreshDevIssues(
  themeId: string,
  palette: Palette,
  roleColors: Record<string, string>,
  scheme: "dark" | "light",
): Promise<void> {
  return useDevStore.getState().refresh(themeId, palette, roleColors, scheme);
}

export function clearDevState(): void {
  useDevStore.getState().clear();
}
