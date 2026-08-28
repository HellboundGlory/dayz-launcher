/**
 * The theme store — the one additive store of the overhaul.
 *
 * State mirrors the board's `state` object exactly: an active theme (preset id
 * or `custom:<name>`), a dark/light mode switch, per-token editor overrides,
 * a bloom factor, and saved skins persisted under `tetra.customThemes`.
 *
 * Every theme — preset or saved skin — is a `{dark, light}` palette pair. The
 * light palette is auto-derived from the dark one (`deriveLight`, hue preserved,
 * 4.5:1 floor) until the user hand-edits light, which latches `lightRefined`.
 */
import { create } from "zustand";
import {
  deriveLight,
  PRESETS,
  NEUTRAL_DARK,
  NEUTRAL_LIGHT,
  TOKENS,
  STORE_KEY,
  type Palette,
  type SavedTheme,
  type CustomOverrides,
  type Token,
} from "./palette";
import { applyTheme } from "./apply";

interface ThemeState {
  scheme: "dark" | "light";
  /** Preset id, or `custom:<name>` for a saved skin. */
  activeId: string;
  /** Editor overrides, per scheme. */
  custom: CustomOverrides;
  /** True once the user hand-edits light — dark edits stop re-deriving then. */
  lightRefined: boolean;
  /** 0–1; "100% = neon, 0 = off". */
  bloom: number;
  myThemes: SavedTheme[];

  hydrate: () => void;
  apply: () => void;
  setScheme: (scheme: "dark" | "light") => void;
  pickTheme: (id: string) => void;
  setBloom: (bloom: number) => void;
  setColorOverride: (token: Token, value: string) => void;
  toggleLightRefined: () => void;
  saveTheme: (name: string) => void;
  deleteTheme: (name: string) => void;
  resetToBase: () => void;
}

export function loadThemes(): SavedTheme[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as SavedTheme[];
  } catch {
    return [];
  }
}

function saveThemes(themes: SavedTheme[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(themes));
}

/** The active selection (which theme, mode, bloom) — a separate key from the
    saved skins so the two shapes stay independent. `custom:<name>` ids keep
    working as long as the skin exists; a deleted skin falls back to neutral
    in `resolvedPair`. */
const ACTIVE_KEY = "tetra.themeActive";

interface ActiveState {
  activeId: string;
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

function saveActive(active: ActiveState): void {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
}

export function activePreset(activeId: string) {
  return PRESETS.find((p) => p.id === activeId);
}

export function activeSaved(activeId: string, myThemes: SavedTheme[]) {
  return myThemes.find((t) => t.name === activeId.replace(/^custom:/, ""));
}

/** Resolve the full dark + light palettes for the active theme. */
export function resolvedPair(activeId: string, myThemes: SavedTheme[]): {
  dark: Palette;
  light: Palette;
} {
  if (activeId === "neutral") return { dark: NEUTRAL_DARK, light: NEUTRAL_LIGHT };
  const p = activePreset(activeId);
  if (p) return { dark: p.dark, light: p.light };
  const s = activeSaved(activeId, myThemes);
  if (s) return { dark: s.dark, light: s.light };
  return { dark: NEUTRAL_DARK, light: NEUTRAL_LIGHT };
}

/** The palette that actually renders for a scheme, overrides merged. */
export function effective(
  scheme: "dark" | "light",
  activeId: string,
  myThemes: SavedTheme[],
  custom: CustomOverrides,
): Palette {
  const base = resolvedPair(activeId, myThemes)[scheme];
  const out = {} as Palette;
  TOKENS.forEach((t) => {
    out[t] = custom[scheme][t] ?? base[t];
  });
  return out;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  scheme: "dark",
  activeId: "neutral",
  custom: { dark: {}, light: {} },
  lightRefined: false,
  bloom: 0.9,
  myThemes: [],

  /** Load saved skins and paint the active theme. Called once before render. */
  hydrate: () => {
    const active = loadActive();
    set({
      myThemes: loadThemes(),
      ...(active.activeId !== undefined && { activeId: active.activeId }),
      ...(active.scheme !== undefined && { scheme: active.scheme }),
      ...(active.bloom !== undefined && { bloom: active.bloom }),
    });
    get().apply();
  },

  apply: () => {
    const { scheme, activeId, custom, bloom, myThemes } = get();
    applyTheme(effective(scheme, activeId, myThemes, custom), scheme, bloom);
    // Every mutation funnels through apply() — persisting here means a
    // theme pick, scheme flip or bloom drag survives a restart without each
    // action having to remember to save.
    saveActive({ activeId, scheme, bloom });
  },

  setScheme: (scheme) => {
    set({ scheme });
    get().apply();
  },

  pickTheme: (id) => {
    if (id.startsWith("custom:")) {
      const name = id.slice(7);
      const t = get().myThemes.find((x) => x.name === name);
      if (!t) return;
      set({
        activeId: id,
        custom: { dark: {}, light: {} },
        lightRefined: false,
        bloom: t.bloom ?? 0.9,
        scheme: t.scheme ?? "dark",
      });
    } else {
      set({ activeId: id, custom: { dark: {}, light: {} }, lightRefined: false });
    }
    get().apply();
  },

  setBloom: (bloom) => {
    set({ bloom });
    get().apply();
  },

  setColorOverride: (token, value) => {
    const { scheme, lightRefined, custom, activeId, myThemes } = get();
    const next: CustomOverrides = {
      dark: { ...custom.dark },
      light: { ...custom.light },
    };
    next[scheme][token] = value;
    // Editing dark re-derives the light pair until the user hand-edits light.
    if (scheme === "dark" && !lightRefined) {
      const base = resolvedPair(activeId, myThemes).dark;
      const darkFull: Palette = { ...base };
      TOKENS.forEach((t) => {
        if (next.dark[t]) darkFull[t] = next.dark[t]!;
      });
      next.light = deriveLight(darkFull);
    }
    set({ custom: next });
    get().apply();
  },

  toggleLightRefined: () => {
    set({ lightRefined: !get().lightRefined });
  },

  saveTheme: (name) => {
    const { scheme, activeId, custom, bloom, myThemes } = get();
    const pair = resolvedPair(activeId, myThemes);
    const dark = {} as Palette;
    const light = {} as Palette;
    TOKENS.forEach((t) => {
      dark[t] = custom.dark[t] ?? pair.dark[t];
      light[t] = custom.light[t] ?? pair.light[t];
    });
    const next = myThemes.filter((t) => t.name !== name);
    next.push({ name, dark, light, bloom, scheme });
    saveThemes(next);
    set({
      myThemes: next,
      activeId: `custom:${name}`,
      custom: { dark: {}, light: {} },
      lightRefined: false,
    });
    get().apply();
  },

  deleteTheme: (name) => {
    const next = get().myThemes.filter((t) => t.name !== name);
    saveThemes(next);
    set({ myThemes: next });
    get().apply();
  },

  resetToBase: () => {
    set({ custom: { dark: {}, light: {} }, lightRefined: false });
    get().apply();
  },
}));
