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
  /** True when the last hot reload was held back because the saved files have errors. */
  heldReload: boolean;
  /** How many LayoutRenderer instances are mounted; 0 means no screen draws from a layout file. */
  activeRenderers: number;

  refresh: (
    themeId: string,
    palette: Palette,
    roleColors: Record<string, string>,
    scheme: "dark" | "light",
  ) => Promise<void>;
  setVariantWidth: (width: number | null) => void;
  setSettingsOverride: (values: Record<string, SettingsValue> | null) => void;
  /** What a hot reload found: its issues, whether it was held, and any read/validate failure. */
  noteReload: (issues: ValidationIssue[], held: boolean, error: string | null) => void;
  /** Registers a mounted renderer and returns its unregister function. */
  registerRenderer: () => () => void;
  clear: () => void;
}

const INITIAL = {
  issues: [] as ValidationIssue[],
  contrast: [] as ValidationIssue[],
  refreshing: false,
  error: null as string | null,
  variantWidth: null as number | null,
  settingsOverride: null as Record<string, SettingsValue> | null,
  heldReload: false,
};

// Guards against a slower earlier refresh overwriting a newer one's results.
let refreshSeq = 0;

export const useDevStore = create<DevStore>((set) => ({
  ...INITIAL,
  activeRenderers: 0,

  refresh: async (themeId, palette, roleColors, scheme) => {
    const seq = ++refreshSeq;
    set({ refreshing: true });
    const contrast = contrastIssues(palette, roleColors, scheme);
    try {
      const issues = await validateTheme(themeId);
      if (seq !== refreshSeq) return;
      set({ issues, contrast, error: null, refreshing: false, heldReload: false });
    } catch (e) {
      if (seq !== refreshSeq) return;
      set({ issues: [], contrast, error: String(e), refreshing: false });
    }
  },

  setVariantWidth: (width) => set({ variantWidth: width }),

  setSettingsOverride: (values) => set({ settingsOverride: values }),

  noteReload: (issues, held, error) => set({ issues, heldReload: held, error }),

  registerRenderer: () => {
    set((s) => ({ activeRenderers: s.activeRenderers + 1 }));
    return () => set((s) => ({ activeRenderers: Math.max(0, s.activeRenderers - 1) }));
  },

  // Renderers may still be mounted when Dev Mode is switched off, so this
  // count must survive clear() — resetting it here would lie next time.
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

export function noteDevReload(issues: ValidationIssue[], held: boolean, error: string | null): void {
  useDevStore.getState().noteReload(issues, held, error);
}
