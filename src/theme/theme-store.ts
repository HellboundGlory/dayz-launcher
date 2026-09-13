// Theme store: active theme (preset id, or a file-backed theme's own id),
// dark/light mode, per-token editor overrides, bloom factor, and the themes
// installed on disk. Every theme is a {dark, light} palette pair; light is
// auto-derived from dark until the user hand-edits it, which latches
// `lightRefined`.
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  deriveLight,
  PRESETS,
  NEUTRAL_DARK,
  NEUTRAL_LIGHT,
  TOKENS,
  STORE_KEY,
  DEFAULT_RADII,
  DEFAULT_SPACING,
  DEFAULT_TYPOGRAPHY,
  type CustomExtrasOverrides,
  type Palette,
  type CustomOverrides,
  type Radii,
  type Spacing,
  type Token,
  type Typography,
} from "./palette";
import { applyTheme, DEFAULT_EXTRAS, type ThemeExtras } from "./apply";
import { applyThemeFonts, applyThemeStylesheet } from "./css-loader";
import {
  armActivation,
  deleteTheme as deleteThemeCmd,
  getSettings,
  getTheme,
  listInstalledThemes,
  migrateLegacyCustomThemes,
  saveTheme as saveThemeCmd,
  setActiveThemeId,
} from "@/lib/tauri";
import type {
  LegacyTheme,
  ThemeFile,
  ThemeManifest,
  ThemeSummary,
} from "@/types/theme";

interface ThemeState {
  scheme: "dark" | "light";
  /** A preset id, or an installed theme's own id (`local.<slug>`). */
  activeId: string;
  /** Editor overrides, per scheme. */
  custom: CustomOverrides;
  /** Editor overrides for spacing/radii/typography — not per-scheme. */
  customExtras: CustomExtrasOverrides;
  /** True once the user hand-edits light — dark edits stop re-deriving then. */
  lightRefined: boolean;
  /** 0–1; "100% = neon, 0 = off". */
  bloom: number;
  installedThemes: ThemeSummary[];
  /** Full theme files, keyed by id. Lazily filled, then reused as the palette source. */
  themeFiles: Record<string, ThemeFile>;

  hydrate: () => Promise<void>;
  apply: () => void;
  setScheme: (scheme: "dark" | "light") => void;
  /** `deleteOnRevert`: `id` was just created by this same action (duplicate,
   * "New theme") — abandoning the activation deletes it too, not just the pick. */
  pickTheme: (id: string, deleteOnRevert?: boolean) => Promise<void>;
  setBloom: (bloom: number) => void;
  setColorOverride: (token: Token, value: string) => void;
  setSpacingOverride: (key: keyof Spacing, value: string) => void;
  setRadiusOverride: (key: keyof Radii, value: string) => void;
  setTypographyOverride: (key: keyof Typography, value: string) => void;
  toggleLightRefined: () => void;
  saveTheme: (name: string) => Promise<void>;
  /** Save `sourceId` under a new name — the active theme's live edits apply only when `sourceId` is the active theme. */
  duplicateTheme: (sourceId: string, name: string) => Promise<void>;
  deleteTheme: (id: string) => Promise<void>;
  resetToBase: () => void;
}

// UI preferences (mode, bloom) — separate key from the retired saved skins.
// The active theme id is not here: it belongs to the backend's settings.json.
const ACTIVE_KEY = "tetra.themeActive";

interface ActiveState {
  /** Only read at hydrate, to recover a pre-migration local selection. */
  activeId?: string;
  scheme: "dark" | "light";
  bloom: number;
}

function loadActive(): Partial<ActiveState> {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? "{}") as Partial<ActiveState>;
    return {
      activeId: typeof raw.activeId === "string" ? raw.activeId : undefined,
      scheme: raw.scheme === "light" ? "light" : undefined,
      bloom: typeof raw.bloom === "number" ? raw.bloom : undefined,
    };
  } catch {
    return {};
  }
}

function saveActive(active: { scheme: "dark" | "light"; bloom: number }): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
}

/** Lowercase, runs of non-alphanumerics collapsed to one `-`, ends trimmed — mirrors Rust `theme::slugify`. */
function slugify(name: string): string {
  let slug = "";
  for (const c of name) {
    if (/[\p{L}\p{N}]/u.test(c)) slug += c.toLowerCase();
    else if (slug !== "" && !slug.endsWith("-")) slug += "-";
  }
  return slug.replace(/^-+|-+$/g, "");
}

/** One scheme's palette out of an untrusted `tokens.json`; missing tokens fall back to neutral. */
function paletteFromTokens(tokens: unknown, scheme: "dark" | "light"): Palette {
  const out = { ...(scheme === "dark" ? NEUTRAL_DARK : NEUTRAL_LIGHT) };
  const raw = (tokens as Record<string, unknown> | null | undefined)?.[scheme];
  if (raw === null || typeof raw !== "object") return out;
  for (const token of TOKENS) {
    const value = (raw as Record<string, unknown>)[token];
    if (typeof value === "string") out[token] = value;
  }
  return out;
}

export function activePreset(activeId: string) {
  return PRESETS.find((p) => p.id === activeId);
}

export function activeInstalled(activeId: string, installedThemes: ThemeSummary[]) {
  return installedThemes.find((t) => t.id === activeId);
}

/** Resolve the full dark + light palettes for the active theme. */
export function resolvedPair(activeId: string, themeFiles: Record<string, ThemeFile>): {
  dark: Palette;
  light: Palette;
} {
  if (activeId === "neutral") return { dark: NEUTRAL_DARK, light: NEUTRAL_LIGHT };
  const p = activePreset(activeId);
  if (p) return { dark: p.dark, light: p.light };
  const file = themeFiles[activeId];
  if (file) {
    return {
      dark: paletteFromTokens(file.tokens, "dark"),
      light: paletteFromTokens(file.tokens, "light"),
    };
  }
  return { dark: NEUTRAL_DARK, light: NEUTRAL_LIGHT };
}

/** The palette that actually renders for a scheme, overrides merged. */
export function effective(
  scheme: "dark" | "light",
  activeId: string,
  themeFiles: Record<string, ThemeFile>,
  custom: CustomOverrides,
): Palette {
  const base = resolvedPair(activeId, themeFiles)[scheme];
  const out = {} as Palette;
  TOKENS.forEach((t) => {
    out[t] = custom[scheme][t] ?? base[t];
  });
  return out;
}

/**
 * Spacing, radii and typography for the active theme. Presets and `neutral`
 * carry colours only, so they always resolve to the static defaults; a
 * file-backed theme may supply any subset, and untrusted values are read the
 * same way `paletteFromTokens` reads colours.
 */
export function resolvedExtras(
  activeId: string,
  themeFiles: Record<string, ThemeFile>,
): ThemeExtras {
  const tokens = themeFiles[activeId]?.tokens;
  if (activeId === "neutral" || activePreset(activeId) !== undefined || tokens === undefined) {
    return DEFAULT_EXTRAS;
  }
  const root = (typeof tokens === "object" && tokens !== null ? tokens : {}) as Record<
    string,
    unknown
  >;
  const spacing = stringEntries(root.spacing);
  const radii = stringEntries(root.radii);
  const typography = stringEntries(root.typography);
  return {
    spacing: {
      xs: spacing.xs ?? DEFAULT_SPACING.xs,
      sm: spacing.sm ?? DEFAULT_SPACING.sm,
      md: spacing.md ?? DEFAULT_SPACING.md,
      lg: spacing.lg ?? DEFAULT_SPACING.lg,
    },
    radii: {
      control: radii.control ?? DEFAULT_RADII.control,
      row: radii.row ?? DEFAULT_RADII.row,
      chip: radii.chip ?? DEFAULT_RADII.chip,
      pill: radii.pill ?? DEFAULT_RADII.pill,
    },
    typography: {
      uiFont: typography.uiFont ?? DEFAULT_TYPOGRAPHY.uiFont,
      dataFont: typography.dataFont ?? DEFAULT_TYPOGRAPHY.dataFont,
    },
    shadows: {
      glowIntensity: glowIntensityOf(root.shadows) ?? DEFAULT_EXTRAS.shadows.glowIntensity,
    },
  };
}

/** The string-valued entries of one untrusted `tokens.json` group; anything else is dropped. */
function stringEntries(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** The numeric `glowIntensity` of an untrusted `tokens.json` `shadows` group; anything else is dropped. */
function glowIntensityOf(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null || !("glowIntensity" in raw)) return undefined;
  const { glowIntensity } = raw;
  return typeof glowIntensity === "number" ? glowIntensity : undefined;
}

/** A theme's declared custom fonts out of its raw `tokens.json`; entries missing a string `family`/`file` are dropped. */
function themeCustomFonts(file: ThemeFile | undefined): { family: string; file: string }[] {
  const tokens: unknown = file?.tokens;
  if (typeof tokens !== "object" || tokens === null) return [];
  const typography = "typography" in tokens ? tokens.typography : undefined;
  if (typeof typography !== "object" || typography === null) return [];
  const customFonts = "customFonts" in typography ? typography.customFonts : undefined;
  if (!Array.isArray(customFonts)) return [];
  const out: { family: string; file: string }[] = [];
  for (const entry of customFonts) {
    if (typeof entry !== "object" || entry === null) continue;
    if (!("family" in entry) || typeof entry.family !== "string") continue;
    if (!("file" in entry) || typeof entry.file !== "string") continue;
    out.push({ family: entry.family, file: entry.file });
  }
  return out;
}

/** The extras that actually render, editor overrides merged. Not per-scheme — these don't vary by mode. */
export function effectiveExtras(
  activeId: string,
  themeFiles: Record<string, ThemeFile>,
  customExtras: CustomExtrasOverrides,
): ThemeExtras {
  const base = resolvedExtras(activeId, themeFiles);
  return {
    spacing: { ...base.spacing, ...customExtras.spacing },
    radii: { ...base.radii, ...customExtras.radii },
    typography: { ...base.typography, ...customExtras.typography },
    // Bloom's live override lives in the store's own `bloom` field (the
    // customiser's slider writes there), so nothing merges here.
    shadows: base.shadows,
  };
}

/**
 * Re-read what's installed, plus every theme's full `tokens.json` — the latter
 * a deliberate tradeoff: `list_installed_themes` itself never reads
 * `tokens.json`, but the picker's two-colour swatch dots need each palette,
 * and at this scale that's negligible — Package 5's paginated grid should
 * revisit lazy-loading if it starts to matter.
 */
async function refreshInstalledThemes(): Promise<void> {
  const installedThemes = await listInstalledThemes();
  const themeFiles: Record<string, ThemeFile> = {};
  await Promise.all(
    installedThemes.map(async (theme) => {
      try {
        themeFiles[theme.id] = await getTheme(theme.id);
      } catch (e) {
        // A hand-edited tokens.json can be unreadable; the theme stays listed
        // and its palette falls back to neutral.
        console.error(`Could not read theme "${theme.id}":`, e);
      }
    }),
  );
  useThemeStore.setState({ installedThemes, themeFiles });
}

/** The pre-migration saved skins, or `null` when that key holds nothing usable. */
function loadLegacyThemes(): LegacyTheme[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as LegacyTheme[]) : null;
  } catch {
    return null;
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  scheme: "dark",
  activeId: "neutral",
  custom: { dark: {}, light: {} },
  customExtras: { spacing: {}, radii: {}, typography: {} },
  lightRefined: false,
  bloom: DEFAULT_EXTRAS.shadows.glowIntensity,
  installedThemes: [],
  themeFiles: {},

  /** Load installed themes and paint the active one. Called once before render. */
  hydrate: async () => {
    const stored = loadActive();

    // One-time import of the skins the pre-file-backed build kept in the
    // frontend's localStorage, keyed by name so a stored `custom:<name>`
    // selection can be remapped onto the id the backend created for it.
    const migratedIds: Record<string, string> = {};
    const legacy = localStorage.getItem(STORE_KEY) === null ? null : loadLegacyThemes();
    if (legacy !== null && legacy.length > 0) {
      try {
        const created = new Set(await migrateLegacyCustomThemes(legacy));
        for (const theme of legacy) {
          const id = `local.${slugify(theme.name)}`;
          if (created.has(id)) migratedIds[theme.name] = id;
        }
      } catch (e) {
        console.error("Could not migrate saved themes:", e);
      }
    }
    // Dropped even on failure: the backend already skips a permanently bad
    // entry, so keeping the key would just retry it every launch.
    if (legacy !== null) localStorage.removeItem(STORE_KEY);

    await refreshInstalledThemes();
    const { installedThemes } = get();

    let activeId = "neutral";
    let onDiskId: string | null = null;
    try {
      const settings = await getSettings();
      onDiskId = settings.activeThemeId ?? null;
    } catch (e) {
      console.error("Could not read the active theme from settings:", e);
    }

    if (onDiskId !== null) {
      activeId = onDiskId;
    } else if (stored.activeId !== undefined) {
      // Recovering a pre-migration local selection: a `custom:<name>` id maps
      // through the migration, anything else must still exist for real.
      if (stored.activeId.startsWith("custom:")) {
        activeId = migratedIds[stored.activeId.slice(7)] ?? "neutral";
      } else if (
        activePreset(stored.activeId) !== undefined ||
        activeInstalled(stored.activeId, installedThemes) !== undefined
      ) {
        activeId = stored.activeId;
      }
      if (activeId !== "neutral") {
        // One-time bootstrap, not a live user pick — deliberately skips the
        // arm/confirm flow, as the migration itself does.
        try {
          await setActiveThemeId(activeId);
        } catch (e) {
          console.error("Could not persist the migrated active theme:", e);
        }
      }
    }

    set({
      activeId,
      ...(stored.scheme !== undefined && { scheme: stored.scheme }),
      ...(stored.bloom !== undefined && { bloom: stored.bloom }),
    });
    get().apply();
  },

  apply: () => {
    const { scheme, activeId, custom, customExtras, bloom, themeFiles } = get();
    applyTheme(effective(scheme, activeId, themeFiles, custom), scheme, {
      ...effectiveExtras(activeId, themeFiles, customExtras),
      shadows: { glowIntensity: bloom },
    });
    // CSS and fonts belong to an installed theme's own files; a preset or
    // neutral has none, which unloads whatever the previous theme had.
    const file = themeFiles[activeId];
    applyThemeStylesheet(file ? activeId : null, file?.capabilities ?? []);
    applyThemeFonts(file ? activeId : null, themeCustomFonts(file));
    // Every mutation funnels through apply() — persisting the UI prefs here
    // means a scheme flip or bloom drag survives a restart without each action
    // having to remember to save. The active id isn't stored locally: only a
    // confirmed activation may change the backend's active theme.
    saveActive({ scheme, bloom });
  },

  setScheme: (scheme) => {
    set({ scheme });
    get().apply();
  },

  pickTheme: async (id, deleteOnRevert = false) => {
    if (activePreset(id) === undefined && get().themeFiles[id] === undefined) {
      try {
        // Not just this theme's file — an id missing from themeFiles is
        // usually missing from installedThemes too (a fresh import).
        await refreshInstalledThemes();
      } catch (e) {
        // Leave the previous theme active rather than half-switching.
        console.error(`Could not load theme "${id}":`, e);
        return;
      }
    }
    set({
      activeId: id,
      custom: { dark: {}, light: {} },
      customExtras: { spacing: {}, radii: {}, typography: {} },
      lightRefined: false,
      // Bloom follows the same base-plus-override shape as the other extras:
      // the picked theme supplies the base, the slider overrides it afterwards.
      bloom: resolvedExtras(id, get().themeFiles).shadows.glowIntensity,
    });
    get().apply();
    try {
      await armActivation(id, deleteOnRevert);
    } catch (e) {
      // The live preview stands either way.
      console.error("Could not arm the theme activation window:", e);
    }
  },

  setBloom: (bloom) => {
    set({ bloom });
    get().apply();
  },

  setColorOverride: (token, value) => {
    const { scheme, lightRefined, custom, activeId, themeFiles } = get();
    const next: CustomOverrides = {
      dark: { ...custom.dark },
      light: { ...custom.light },
    };
    next[scheme][token] = value;
    // Editing dark re-derives the light pair until the user hand-edits light.
    if (scheme === "dark" && !lightRefined) {
      const base = resolvedPair(activeId, themeFiles).dark;
      const darkFull: Palette = { ...base };
      TOKENS.forEach((t) => {
        if (next.dark[t]) darkFull[t] = next.dark[t]!;
      });
      next.light = deriveLight(darkFull);
    }
    set({ custom: next });
    get().apply();
  },

  // Extras overrides are flat, not per-scheme: spacing, radii and fonts don't
  // vary between dark and light, so nothing here re-derives anything.
  setSpacingOverride: (key, value) => {
    const { spacing } = get().customExtras;
    set({ customExtras: { ...get().customExtras, spacing: { ...spacing, [key]: value } } });
    get().apply();
  },

  setRadiusOverride: (key, value) => {
    const { radii } = get().customExtras;
    set({ customExtras: { ...get().customExtras, radii: { ...radii, [key]: value } } });
    get().apply();
  },

  setTypographyOverride: (key, value) => {
    const { typography } = get().customExtras;
    set({ customExtras: { ...get().customExtras, typography: { ...typography, [key]: value } } });
    get().apply();
  },

  toggleLightRefined: () => {
    set({ lightRefined: !get().lightRefined });
  },

  saveTheme: async (name) => {
    await get().duplicateTheme(get().activeId, name);
  },

  duplicateTheme: async (sourceId, name) => {
    const { activeId, custom, customExtras, themeFiles } = get();
    const live = sourceId === activeId;
    const pair = resolvedPair(sourceId, themeFiles);
    const dark = {} as Palette;
    const light = {} as Palette;
    TOKENS.forEach((t) => {
      dark[t] = (live ? custom.dark[t] : undefined) ?? pair.dark[t];
      light[t] = (live ? custom.light[t] : undefined) ?? pair.light[t];
    });

    const id = `local.${slugify(name)}`;
    const manifest: ThemeManifest = {
      schemaVersion: 1,
      id,
      name,
      author: "local",
      version: "1.0.0",
      themeApi: "1.0",
      // No frontend-exposed app version yet; "0.0.0" means no floor.
      minimumLauncherVersion: "0.0.0",
      tier: "basic",
      description: "",
      preview: null,
      license: null,
      homepage: null,
      tags: [],
      capabilities: ["tokens"],
    };
    const tokens = {
      schemaVersion: 1,
      dark,
      light,
      ...(live ? effectiveExtras(sourceId, themeFiles, customExtras) : resolvedExtras(sourceId, themeFiles)),
    };

    try {
      // save_theme is create-only; re-saving under a name already used
      // overwrites, as the old localStorage store did. The delete is refused
      // for the active theme, in which case the save below reports the clash.
      if (activeInstalled(id, get().installedThemes) !== undefined) {
        await deleteThemeCmd(id);
      }
      await saveThemeCmd(manifest, tokens);
    } catch (e) {
      console.error(`Could not save theme "${name}":`, e);
      return;
    }

    await refreshInstalledThemes();
    // Same arm/confirm flow as any other activation; deleteOnRevert so an
    // abandoned duplicate doesn't linger in the library.
    await get().pickTheme(id, true);
  },

  deleteTheme: async (id) => {
    try {
      await deleteThemeCmd(id);
    } catch (e) {
      // Refuses the active theme; nothing changed, so nothing to undo.
      console.error(`Could not delete theme "${id}":`, e);
      return;
    }
    await refreshInstalledThemes();
  },

  resetToBase: () => {
    set({
      custom: { dark: {}, light: {} },
      customExtras: { spacing: {}, radii: {}, typography: {} },
      lightRefined: false,
    });
    get().apply();
  },
}));

/** Reverts the live preview when the guard window times out or the user reverts. */
export function watchThemeActivationReverted(): () => void {
  const pending = listen<{ previousId: string | null }>(
    "theme-activation-reverted",
    (event) => {
      const state = useThemeStore.getState();
      const activeId = event.payload.previousId ?? "neutral";
      // Bloom is theme-supplied now, so the revert has to re-seed it the same
      // way pickTheme does — otherwise the abandoned preview's glow persists.
      useThemeStore.setState({
        activeId,
        bloom: resolvedExtras(activeId, state.themeFiles).shadows.glowIntensity,
      });
      state.apply();
      // A reverted duplicate/"New theme" was just deleted on the backend —
      // re-sync so the grid doesn't keep showing it.
      void refreshInstalledThemes();
    },
  );
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}
