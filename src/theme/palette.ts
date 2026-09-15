// Theme palette math: pure functions only, no React/DOM/store. Light-mode
// colors are auto-derived from dark (hue preserved, 4.5:1 WCAG floor) —
// locked by the hue-sweep contrast test in palette.test.ts.

export type Token =
  | "bg"
  | "surface"
  | "surface2"
  | "border"
  | "text"
  | "muted"
  | "muted2"
  | "accent"
  | "accent2"
  | "success"
  | "warn"
  | "danger";

/** A full palette: one hex string per token. */
export type Palette = Record<Token, string>;

export interface ThemePair {
  dark: Palette;
  light: Palette;
}

// ── Colour math ───────────────────────────────────────────────────

export function hexToRgb(h: string): [number, number, number] {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const f = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return "#" + f(r) + f(g) + f(b);
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export const hsl = (h: number, s: number, l: number): string =>
  rgbToHex(...hslToRgb(h, s, l));

export const hexToHsl = (h: string): [number, number, number] =>
  rgbToHsl(...hexToRgb(h));

export const rgba = (hex: string, a: number): string =>
  `rgba(${hexToRgb(hex).join(",")}, ${a})`;

export function lum(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const l1 = lum(a);
  const l2 = lum(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// ── Theme derivation: light palette from dark, 4.5:1 contrast floor ─

export function deriveLight(dark: Palette, TARGET = 4.5): Palette {
  const hue = hexToHsl(dark.accent)[0];
  const N = (l: number, s: number) => hsl(hue, s, l);
  const light: Palette = {
    bg: N(0.965, 0.045),
    surface: N(1.0, 0.0),
    surface2: N(0.92, 0.05),
    border: N(0.85, 0.05),
    text: N(0.1, 0.04),
    muted: N(0.44, 0.05),
    muted2: N(0.58, 0.05),
    accent: "#000000",
    accent2: "#000000",
    success: "#000000",
    warn: "#000000",
    danger: "#000000",
  };
  function accentHex(hex: string): string {
    const [h, s0] = hexToHsl(hex);
    const s = Math.min(s0, 0.66);
    // Keep hue; find the brightest L (from 0.60 down) that clears TARGET vs light.bg.
    let out = hsl(h, s, 0.3);
    for (let L = 0.6; L >= 0.12; L -= 0.01) {
      const c = hsl(h, s, L);
      if (contrast(c, light.bg) >= TARGET) {
        out = c;
        break;
      }
    }
    return out;
  }
  light.accent = accentHex(dark.accent);
  light.accent2 = accentHex(dark.accent2);
  light.success = accentHex(dark.success);
  light.warn = accentHex(dark.warn);
  light.danger = accentHex(dark.danger);
  return light;
}

// ── Base palettes + presets (each is a dark+light pair) ────────────

export const NEUTRAL_DARK: Palette = {
  bg: "#0d0f13",
  surface: "#12151b",
  surface2: "#1a1e26",
  border: "#262b34",
  text: "#e7ebf0",
  muted: "#7a8494",
  muted2: "#98a2b2",
  accent: "#8fa3bd",
  accent2: "#b0976a",
  success: "#4d9a75",
  warn: "#c19a55",
  danger: "#b3564d",
};

export const NEUTRAL_LIGHT: Palette = {
  bg: "#f3f4f6",
  surface: "#ffffff",
  surface2: "#e9ebef",
  border: "#d2d6dc",
  text: "#181b20",
  muted: "#5d6570",
  muted2: "#8a919d",
  accent: "#3e5f7d",
  accent2: "#8a6d34",
  success: "#287a4f",
  warn: "#9a7b3a",
  danger: "#a94a42",
};


export interface Preset {
  id: string;
  name: string;
  dark: Palette;
  light: Palette;
}

export const PRESETS: Preset[] = [
  { id: "neutral", name: "Neutral", dark: NEUTRAL_DARK, light: NEUTRAL_LIGHT },
];

export const TOKENS: Token[] = [
  "bg",
  "surface",
  "surface2",
  "border",
  "text",
  "muted",
  "muted2",
  "accent",
  "accent2",
  "success",
  "warn",
  "danger",
];

export interface TokenGroup {
  name: string;
  keys: Token[];
  labels: Record<string, string>;
}

export const GROUP_DEF: TokenGroup[] = [
  {
    name: "Surfaces",
    keys: ["bg", "surface", "surface2", "border"],
    labels: { bg: "Background", surface: "Surface", surface2: "Surface 2", border: "Border" },
  },
  {
    name: "Text",
    keys: ["text", "muted", "muted2"],
    labels: { text: "Text", muted: "Muted text", muted2: "Muted text 2" },
  },
  {
    name: "Accents",
    keys: ["accent", "accent2"],
    labels: { accent: "Accent (primary)", accent2: "Accent 2 (secondary)" },
  },
  {
    name: "Semantic",
    keys: ["success", "warn", "danger"],
    labels: { success: "Success", warn: "Warning", danger: "Danger" },
  },
];

export const STORE_KEY = "tetra.customThemes";

/** Editor overrides: a partial palette per scheme. */
export type CustomOverrides = { dark: Partial<Palette>; light: Partial<Palette> };

// ── Non-colour design tokens: spacing / radii / typography ─────────
// Plain data, like the colour palette above. Defaults mirror main.css's
// existing static values, so applying them is a no-op until overridden.

export interface Spacing {
  xs: string;
  sm: string;
  md: string;
  lg: string;
}

export interface Radii {
  control: string;
  row: string;
  chip: string;
  pill: string;
}

export interface Typography {
  uiFont: string;
  dataFont: string;
}

export const DEFAULT_SPACING: Spacing = { xs: "2px", sm: "4px", md: "8px", lg: "16px" };
export const DEFAULT_RADII: Radii = { control: "6px", row: "8px", chip: "3px", pill: "999px" };
export const DEFAULT_TYPOGRAPHY: Typography = {
  uiFont: '"Inter", "Segoe UI", system-ui, sans-serif',
  dataFont: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
};

/** Editor overrides for the non-colour tokens. Plain, not per-scheme — none of these vary by mode. */
export interface CustomExtrasOverrides {
  spacing: Partial<Spacing>;
  radii: Partial<Radii>;
  typography: Partial<Typography>;
}
