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
  type CustomExtrasOverrides,
  type FontFamilyRole,
  type Palette,
  type CustomOverrides,
  type RadiusRole,
  type Token,
} from "./palette";
import { applyTheme, DEFAULT_EXTRAS, type ThemeExtras } from "./apply";
import { useDevStore } from "./dev/dev-store";
import { NEUTRAL_TOKENS, parseTokens, resolveTokens, type TokensV2, type TokenValue } from "./tokens";
import { applyThemeStylesheet } from "./css-loader";
import {
  resolveSettingsSchema,
  substitutePlaceholders,
  type SettingsField,
} from "./settings-schema";
import {
  armActivation,
  deleteTheme as deleteThemeCmd,
  getSettings,
  getTheme,
  getThemeSettingsValues,
  listInstalledThemes,
  migrateLegacyCustomThemes,
  saveTheme as saveThemeCmd,
  setActiveThemeId,
  setThemeSettingsValue,
  updateThemeTokens,
  validateTheme,
} from "@/lib/tauri";
import type { LegacyTheme, ThemeFile, ThemeManifest, ThemeSummary, ValidationIssue } from "@/types/theme";
import { getNeutralLayout } from "./neutral";
import { clearFallbacks, isFileFallenBack, markFileFallback, useFallbackStore } from "./fallback/store";
import type { LayoutFile } from "./renderer/types";

export type SettingsValue = string | number | boolean;

/** A v1 folder hydrate switched off, kept only until its one-time notice is dismissed. */
export interface IncompatibleSwitch {
  id: string;
  name: string;
}

interface ThemeState {
  scheme: "dark" | "light";
  /** A preset id, or an installed theme's own id (`local.<slug>`). */
  activeId: string;
  /** Editor overrides, per scheme. */
  custom: CustomOverrides;
  /** Editor overrides for the v2 radius roles and font families — not per-scheme. */
  customExtras: CustomExtrasOverrides;
  /** True once the user hand-edits light — dark edits stop re-deriving then. */
  lightRefined: boolean;
  /** 0–1; "100% = neon, 0 = off". */
  bloom: number;
  installedThemes: ThemeSummary[];
  /** Full theme files, keyed by id. Lazily filled, then reused as the palette source. */
  themeFiles: Record<string, ThemeFile>;
  /** Each theme's tuned settings-schema values, keyed by id — merged over that
   * theme's own schema defaults when written, so `apply()` only ever reads a
   * complete set and never has to know about defaults itself. */
  settingsValues: Record<string, Record<string, SettingsValue>>;
  /** SPEC §16.3: the v1 theme hydrate found active and switched off, or `null`. */
  incompatibleSwitch: IncompatibleSwitch | null;

  /** Clears `incompatibleSwitch` and records that its notice was dismissed. */
  dismissIncompatibleSwitch: () => void;
  hydrate: () => Promise<void>;
  apply: () => void;
  /** Tune one field: writes it through the backend, mirrors it into
   * `settingsValues` immediately, then repaints. */
  setSettingsValue: (id: string, fieldId: string, value: SettingsValue) => Promise<void>;
  setScheme: (scheme: "dark" | "light") => void;
  /** `deleteOnRevert`: `id` was just created by this same action (duplicate,
   * "New theme") — abandoning the activation deletes it too, not just the pick. */
  pickTheme: (id: string, deleteOnRevert?: boolean) => Promise<void>;
  setBloom: (bloom: number) => void;
  setColorOverride: (token: Token, value: string) => void;
  setRadiusRoleOverride: (role: RadiusRole, value: string) => void;
  setFontFamilyOverride: (family: FontFamilyRole, value: string) => void;
  toggleLightRefined: () => void;
  /** Save the active theme: in place when it is a user theme, otherwise as a new theme named `name` (SPEC §4.6). */
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

// SPEC §16.3's one-time notice, per switched-off theme id.
const INCOMPATIBLE_NOTICE_KEY = "tetra.incompatibleNoticeShown.";

function incompatibleNoticeShown(id: string): boolean {
  try {
    return localStorage.getItem(INCOMPATIBLE_NOTICE_KEY + id) !== null;
  } catch {
    return false;
  }
}

function markIncompatibleNoticeShown(id: string): void {
  try {
    localStorage.setItem(INCOMPATIBLE_NOTICE_KEY + id, "true");
  } catch {
    // Only means the notice comes back next launch.
  }
}

/** Lowercase, runs of non-alphanumerics collapsed to one `-`, ends trimmed — mirrors Rust `theme::slugify`. Exported so the "New theme" picker derives a scaffolded theme's id the same way `duplicateTheme` derives a duplicate's. */
export function slugify(name: string): string {
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
  const root = tokens as Record<string, unknown> | null | undefined;
  const raw = root?.schemaVersion === 2
    ? parseTokens(root).colors?.[scheme]
    : root?.[scheme];
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

/** SPEC §4.6's "user theme": an installed theme this launcher created (`local.*`),
 * and so the only kind [`ThemeState.saveTheme`] may rewrite in place. */
export function isUserTheme(id: string, installedThemes: ThemeSummary[]): boolean {
  return id.startsWith("local.") && activeInstalled(id, installedThemes) !== undefined;
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
 * The active theme's own glow strength. Presets and `neutral` carry colours
 * only, so they always resolve to the default; a file-backed theme supplies it
 * either as a v2 `bloom` or, for a pre-v2 file, as `shadows.glowIntensity`.
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
  const glowIntensity =
    (root.schemaVersion === 2 ? parseTokens(root).bloom : glowIntensityOf(root.shadows)) ??
    DEFAULT_EXTRAS.shadows.glowIntensity;
  return { shadows: { glowIntensity } };
}

/** The numeric `glowIntensity` of an untrusted `tokens.json` `shadows` group; anything else is dropped. */
function glowIntensityOf(raw: unknown): number | undefined {
  if (typeof raw !== "object" || raw === null || !("glowIntensity" in raw)) return undefined;
  const { glowIntensity } = raw;
  return typeof glowIntensity === "number" ? glowIntensity : undefined;
}

/** A role's value: the scale step it names, or the literal itself. */
function resolveStep(scale: unknown, value: TokenValue | undefined): string {
  if (
    typeof value === "string" &&
    typeof scale === "object" &&
    scale !== null &&
    Object.prototype.hasOwnProperty.call(scale, value)
  ) {
    return String((scale as Record<string, TokenValue>)[value]);
  }
  return String(value);
}

/**
 * The theme's own v2 tokens with the customiser's role overrides merged on top
 * — what `applyTheme` writes as `--t-…`, and what a live duplicate saves.
 * Neutral fills anything the theme or the overrides leave out.
 */
export function mergeRoleOverrides(
  tokens: Partial<TokensV2> | undefined,
  customExtras: CustomExtrasOverrides,
): Partial<TokensV2> | undefined {
  const { radius, family } = customExtras;
  const hasRadius = Object.keys(radius).length > 0;
  const hasFamily = Object.keys(family).length > 0;
  if (tokens === undefined && !hasRadius && !hasFamily) return undefined;
  return {
    // The customiser never edits glow, so it rides along with the roles.
    glow: tokens?.glow,
    scales: {
      ...tokens?.scales,
      ...(hasFamily && {
        type: { ...tokens?.scales?.type, family: { ...tokens?.scales?.type?.family, ...family } },
      }),
    },
    roles: {
      ...tokens?.roles,
      ...(hasRadius && { radius: { ...tokens?.roles?.radius, ...radius } }),
    },
  };
}

/**
 * The v2 tokens a save writes: the source's own scales and roles (Neutral's
 * when the source carries none), its palette — plus the live editor's colours,
 * bloom and role overrides when `live` — and the bloom. Shared by the in-place
 * save and a duplicate so both write the same shape (SPEC §4.6).
 */
function buildSavedTokens(
  sourceId: string,
  live: boolean,
  custom: CustomOverrides,
  customExtras: CustomExtrasOverrides,
  themeFiles: Record<string, ThemeFile>,
  bloom: number,
): TokensV2 {
  const pair = resolvedPair(sourceId, themeFiles);
  const dark = {} as Palette;
  const light = {} as Palette;
  TOKENS.forEach((t) => {
    dark[t] = (live ? custom.dark[t] : undefined) ?? pair.dark[t];
    light[t] = (live ? custom.light[t] : undefined) ?? pair.light[t];
  });

  // Only a v2 source carries scales/roles to copy; a palette-only or v1
  // source starts from Neutral's.
  const sourceTokens = themeFiles[sourceId]?.tokens;
  const parsedSource =
    typeof sourceTokens === "object" &&
    sourceTokens !== null &&
    "schemaVersion" in sourceTokens &&
    sourceTokens.schemaVersion === 2
      ? parseTokens(sourceTokens)
      : undefined;
  const source = {
    scales: parsedSource?.scales ?? NEUTRAL_TOKENS.scales,
    roles: parsedSource?.roles ?? NEUTRAL_TOKENS.roles,
  };
  // Saving the active theme takes the customiser's role edits with it; a copy
  // of any other theme keeps that theme's own roles.
  const merged = (live ? mergeRoleOverrides(source, customExtras) : undefined) ?? source;
  return {
    schemaVersion: 2,
    colors: { dark, light },
    // Saving the live theme keeps whatever the slider shows; a copy of any
    // other theme keeps that theme's own bloom.
    bloom: live ? bloom : resolvedExtras(sourceId, themeFiles).shadows.glowIntensity,
    glow: parsedSource?.glow,
    scales: merged.scales ?? NEUTRAL_TOKENS.scales,
    roles: merged.roles ?? NEUTRAL_TOKENS.roles,
  };
}

/** The six values the customiser's inputs show: the active theme's resolved roles over Neutral, editor overrides on top. */
export function effectiveRoleValues(
  activeId: string,
  themeFiles: Record<string, ThemeFile>,
  customExtras: CustomExtrasOverrides,
): { radius: Record<RadiusRole, string>; family: Record<FontFamilyRole, string> } {
  const raw = themeFiles[activeId]?.tokens as Record<string, unknown> | undefined;
  const resolved = resolveTokens(raw?.schemaVersion === 2 ? parseTokens(raw) : undefined);
  const { scales, roles } = resolved;
  return {
    radius: {
      window: resolveStep(scales.radius, roles.radius.window),
      panel: resolveStep(scales.radius, roles.radius.panel),
      row: resolveStep(scales.radius, roles.radius.row),
      control: resolveStep(scales.radius, roles.radius.control),
      ...customExtras.radius,
    },
    family: {
      ui: String(scales.type.family.ui),
      data: String(scales.type.family.data),
      ...customExtras.family,
    },
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
  syncFallbacks(useThemeStore.getState().activeId);
}

/**
 * The values that actually render for a theme: one entry per resolved field,
 * every field present. Whatever the user tuned wins, the field's own schema
 * default fills the rest — a never-tuned field reads as its default rather
 * than `undefined`. The stored sidecar is untrusted in type, so anything that
 * isn't a matching number/boolean counts as untuned. Exported for its own
 * tests; `apply()` only ever reads the result.
 */
export function mergeSettingsValues(
  fields: SettingsField[],
  stored: Record<string, unknown>,
): Record<string, SettingsValue> {
  const values: Record<string, SettingsValue> = {};
  for (const field of fields) {
    const raw = stored[field.id];
    if (field.type === "number") {
      values[field.id] =
        typeof raw === "number" && raw >= field.min && raw <= field.max ? raw : field.default;
    } else if (field.type === "boolean") {
      values[field.id] = typeof raw === "boolean" ? raw : field.default;
    } else if (field.type === "choice") {
      values[field.id] =
        typeof raw === "string" && field.options.some((opt) => opt.value === raw)
          ? raw
          : field.default;
    } else if (field.type === "color") {
      values[field.id] =
        typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : field.default;
    }
  }
  return values;
}

/** Read one theme's tuned values into the cache, merged over its own schema
 * defaults. Keyed off the theme's schema for the fields it declares — a value
 * for a field the schema no longer has is dropped, as it renders nowhere. */
async function refreshSettingsValues(id: string): Promise<void> {
  const file = useThemeStore.getState().themeFiles[id];
  if (file === undefined) return;
  let stored: Record<string, unknown> = {};
  try {
    stored = await getThemeSettingsValues(id);
  } catch (e) {
    // No sidecar yet is the ordinary case; a real failure still renders the
    // schema's own defaults rather than nothing.
    console.error(`Could not read settings values for theme "${id}":`, e);
  }
  const values = mergeSettingsValues(resolveSettingsSchema(file.settingsSchema).fields, stored);
  useThemeStore.setState((state) => ({
    settingsValues: { ...state.settingsValues, [id]: values },
  }));
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

/** Mirrors the active theme's dropped layout files into the fallback store, which the layout getters switch on. */
function syncFallbacks(id: string): void {
  clearFallbacks();
  for (const issue of useThemeStore.getState().themeFiles[id]?.fallbacks ?? []) {
    markFileFallback(id, issue.file, `${issue.ruleId}: ${issue.message}`);
  }
}

/** SPEC §16.4: a hot reload keeps a broken file's last valid version on screen instead of falling back. */
function holdLastValidLayouts(file: ThemeFile, previous: ThemeFile | undefined): ThemeFile {
  const fallbacks = file.fallbacks ?? [];
  if (fallbacks.length === 0 || previous?.layouts === undefined) return file;
  const held = new Set<string>();
  const layouts = { ...file.layouts };
  for (const issue of fallbacks) {
    const prior = previous.layouts[issue.file];
    if (prior === undefined) continue;
    layouts[issue.file] = prior;
    held.add(issue.file);
  }
  if (held.size === 0) return file;
  return { ...file, layouts, fallbacks: fallbacks.filter((issue) => !held.has(issue.file)) };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  scheme: "dark",
  activeId: "neutral",
  custom: { dark: {}, light: {} },
  customExtras: { radius: {}, family: {} },
  lightRefined: false,
  bloom: DEFAULT_EXTRAS.shadows.glowIntensity,
  installedThemes: [],
  themeFiles: {},
  settingsValues: {},
  incompatibleSwitch: null,

  dismissIncompatibleSwitch: () => {
    const replaced = get().incompatibleSwitch;
    if (replaced !== null) markIncompatibleNoticeShown(replaced.id);
    set({ incompatibleSwitch: null });
  },

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

    // A v1 folder left on disk is never rendered: the backend flags it, and
    // the stored active id could be stale from before the theme went bad.
    const replaced = activeInstalled(activeId, installedThemes);
    let incompatibleSwitch: IncompatibleSwitch | null = null;
    if (replaced?.incompatible) {
      activeId = "neutral";
      // Persisted like the migration above, so the next launch doesn't re-switch.
      try {
        await setActiveThemeId(activeId);
      } catch (e) {
        console.error("Could not persist the active theme after an incompatible switch:", e);
      }
      if (!incompatibleNoticeShown(replaced.id)) {
        incompatibleSwitch = { id: replaced.id, name: replaced.name };
      }
    }

    set({
      activeId,
      incompatibleSwitch,
      ...(stored.scheme !== undefined && { scheme: stored.scheme }),
      ...(stored.bloom !== undefined && { bloom: stored.bloom }),
    });
    syncFallbacks(activeId);
    // Before the first paint, so a theme the user already tuned renders its
    // tuned values immediately rather than one tick later.
    await refreshSettingsValues(activeId);
    get().apply();
  },

  apply: () => {
    const { scheme, activeId, custom, customExtras, bloom, themeFiles, settingsValues } = get();
    // Substituting templates is every apply()'s business, not just the settings
    // form's: a scheme flip, a bloom drag or a revert all repaint the same
    // tuned tokens. A theme with no cached values (a preset, or an installed
    // theme nothing has tuned) is left alone — substituting nothing would only
    // leave the placeholders literal, which already fails whatever gated them.
    // Dev Mode's settings override, when set, stands in for the stored values
    // so an author can preview a combination without tuning it for real.
    const devOverride = useDevStore.getState().settingsOverride;
    const values = devOverride ?? settingsValues[activeId];
    const raw = themeFiles[activeId];
    const files =
      values === undefined || raw === undefined
        ? themeFiles
        : {
            ...themeFiles,
            [activeId]: {
              ...raw,
              tokens: substitutePlaceholders(raw.tokens, values),
            },
          };
    const tokenFile = files[activeId]?.tokens as Record<string, unknown> | undefined;
    const tokens = tokenFile?.schemaVersion === 2 ? parseTokens(tokenFile) : undefined;
    applyTheme(
      effective(scheme, activeId, files, custom),
      scheme,
      { shadows: { glowIntensity: bloom } },
      mergeRoleOverrides(tokens, customExtras),
      values ?? {},
    );
    // CSS belongs to an installed theme's own files; a preset or
    // neutral has none, which unloads whatever the previous theme had.
    const file = files[activeId];
    applyThemeStylesheet(file ? activeId : null, file?.capabilities ?? []);
    // Every mutation funnels through apply() — persisting the UI prefs here
    // means a scheme flip or bloom drag survives a restart without each action
    // having to remember to save. The active id isn't stored locally: only a
    // confirmed activation may change the backend's active theme.
    saveActive({ scheme, bloom });
  },

  setSettingsValue: async (id, fieldId, value) => {
    try {
      await setThemeSettingsValue(id, fieldId, value as unknown as number | boolean);
    } catch (e) {
      console.error(`Could not save setting "${fieldId}" for theme "${id}":`, e);
      return;
    }
    // Mirror the write into the cache so the running app repaints from the
    // value just persisted, rather than waiting on a re-read of the sidecar.
    // A theme whose values were never read falls back to its schema defaults
    // for the fields not being written here.
    set((state) => {
      const file = state.themeFiles[id];
      const base =
        state.settingsValues[id] ??
        mergeSettingsValues(resolveSettingsSchema(file?.settingsSchema).fields, {});
      return { settingsValues: { ...state.settingsValues, [id]: { ...base, [fieldId]: value } } };
    });
    get().apply();
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
      customExtras: { radius: {}, family: {} },
      lightRefined: false,
      // Bloom follows the same base-plus-override shape as the other extras:
      // the picked theme supplies the base, the slider overrides it afterwards.
      bloom: resolvedExtras(id, get().themeFiles).shadows.glowIntensity,
    });
    syncFallbacks(id);
    // Before apply(), so a theme with tuned values renders tuned the moment it
    // becomes active — not one tick later.
    await refreshSettingsValues(id);
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

  // Role overrides are flat, not per-scheme: radii and fonts don't vary
  // between dark and light, so nothing here re-derives anything. They land in
  // the v2 tokens apply() hands to applyTheme, which is what the `--t-…`
  // variables are written from.
  setRadiusRoleOverride: (role, value) => {
    const customExtras = get().customExtras;
    set({ customExtras: { ...customExtras, radius: { ...customExtras.radius, [role]: value } } });
    get().apply();
  },

  setFontFamilyOverride: (family, value) => {
    const customExtras = get().customExtras;
    set({ customExtras: { ...customExtras, family: { ...customExtras.family, [family]: value } } });
    get().apply();
  },

  toggleLightRefined: () => {
    set({ lightRefined: !get().lightRefined });
  },

  saveTheme: async (name) => {
    const { activeId, installedThemes, custom, customExtras, themeFiles, bloom } = get();
    // SPEC §4.6: the edits land in the active theme when it is a user theme —
    // one this launcher made (`local.*`). An imported package or a bundled
    // built-in is never rewritten, so saving over one duplicates instead.
    if (isUserTheme(activeId, installedThemes)) {
      const tokens = buildSavedTokens(activeId, true, custom, customExtras, themeFiles, bloom);
      try {
        await updateThemeTokens(activeId, tokens);
      } catch (e) {
        console.error(`Could not save theme "${activeId}":`, e);
        return;
      }
      try {
        // Re-read what's on disk so the cached palette is the file just written.
        const file = await getTheme(activeId);
        set((state) => ({ themeFiles: { ...state.themeFiles, [activeId]: file } }));
      } catch (e) {
        // The write landed; a stale cache only delays the repaint.
        console.error(`Could not re-read theme "${activeId}":`, e);
      }
      // The overrides are the theme's own values now.
      get().resetToBase();
      return;
    }
    await get().duplicateTheme(activeId, name);
  },

  duplicateTheme: async (sourceId, name) => {
    const { activeId, custom, customExtras, themeFiles, bloom } = get();

    const id = `local.${slugify(name)}`;
    const manifest: ThemeManifest = {
      schemaVersion: 2,
      id,
      name,
      author: "local",
      version: "1.0.0",
      themeApi: "2.0",
      // No frontend-exposed app version yet; "0.0.0" means no floor.
      minimumLauncherVersion: "0.0.0",
      description: "",
      preview: null,
      license: null,
      homepage: null,
      tags: [],
      capabilities: ["tokens"],
    };
    const tokens = buildSavedTokens(
      sourceId,
      sourceId === activeId,
      custom,
      customExtras,
      themeFiles,
      bloom,
    );

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
      customExtras: { radius: {}, family: {} },
      lightRefined: false,
    });
    get().apply();
  },
}));

/** Reverts the live preview when the guard window times out or the user reverts. */
export function watchThemeActivationReverted(): () => void {
  const pending = listen<{ previousId: string | null }>("theme-activation-reverted", (event) => {
    const { previousId } = event.payload;
    // Re-seed the id and the theme-supplied bloom, repaint, then re-sync the
    // grid — a reverted duplicate was just deleted.
    const state = useThemeStore.getState();
    const activeId = previousId ?? "neutral";
    useThemeStore.setState({
      activeId,
      bloom: resolvedExtras(activeId, state.themeFiles).shadows.glowIntensity,
    });
    syncFallbacks(activeId);
    state.apply();
    void refreshInstalledThemes();
  });
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}

/** Re-reads the active theme's own files on the Dev Mode watch's change event. */
export function watchHotReload(): () => void {
  const pending = listen<{ id: string }>("theme-hot-reload", (event) => {
    const id = event.payload.id;
    // Read the id live, not captured at registration: the active theme can
    // change while an earlier theme's watch is still in flight.
    if (id !== useThemeStore.getState().activeId) return;
    void getTheme(id)
      .catch((e) => {
        console.error(`Could not hot-reload theme "${id}":`, e);
        // Nothing was swapped in, so the last valid version stays on screen.
        useDevStore.getState().noteReload([], true, String(e));
        return null;
      })
      .then((file) => {
        if (file === null) return;
        const swapAndApply = (issues: ValidationIssue[], held: boolean, error: string | null) => {
          useDevStore.getState().noteReload(issues, held, error);
          if (held) return;
          const store = useThemeStore.getState();
          const next = holdLastValidLayouts(file, store.themeFiles[id]);
          useThemeStore.setState({ themeFiles: { ...store.themeFiles, [id]: next } });
          syncFallbacks(id);
          store.apply();
        };
        return validateTheme(id).then(
          (issues) => swapAndApply(issues, issues.some((i) => i.severity === "error"), null),
          // Can't prove the new files are bad — swap in and apply as usual.
          (e) => swapAndApply([], false, String(e)),
        );
      });
  });
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}

export function getActiveLayout(path: string): LayoutFile | undefined {
  if (isFileFallenBack(path)) return getNeutralLayout(path);
  const { activeId, themeFiles } = useThemeStore.getState();
  const file = themeFiles[activeId]?.layouts?.[path];
  if (file) return file;
  return getNeutralLayout(path);
}

/** Like `getActiveLayout`, but only the active theme's own file — never Neutral. */
export function getThemeOwnedLayout(path: string): LayoutFile | undefined {
  if (isFileFallenBack(path)) return undefined;
  const { activeId, themeFiles } = useThemeStore.getState();
  return themeFiles[activeId]?.layouts?.[path];
}

/** Re-renders a component that reads the layout getters when theme files swap or a file falls back. */
export function useLayoutSubscription(): void {
  useThemeStore((s) => s.activeId);
  useThemeStore((s) => s.themeFiles);
  useFallbackStore((s) => s.fallbackFiles);
}

