/**
 * The IPC shapes of the theme commands, hand-kept in sync with the Rust structs
 * in `src-tauri/src/theme/mod.rs` and `src-tauri/src/theme/manifest.rs` — this
 * repo has no codegen, so a field added on one side has to be added here too.
 *
 * Rust's `snake_case` field names are spelled `camelCase` here: every struct
 * carries `#[serde(rename_all = "camelCase")]`, so these are the names actually
 * on the wire. `Option<T>` fields are `| null` rather than optional, matching
 * how the backend serialises them.
 *
 * Deliberately free of any palette/theme-system import: a token's meaning is
 * `src/theme/palette.ts`'s concern, and this file only describes the boundary.
 */

/** One theme's `theme.json`, as the backend reads and writes it. */
export interface ThemeManifest {
  /** Schema this manifest was written to; a manifest predating the field reads as the current version. */
  schemaVersion: number;
  /** The theme's identity, and its directory name under `themes/`. */
  id: string;
  name: string;
  author: string;
  version: string;
  /** The token API this theme's `tokens.json` is written against. */
  themeApi: string;
  /** Oldest launcher that can load this theme — the frontend's compatibility gate. */
  minimumLauncherVersion: string;
  /** How much of the theme system it uses: `basic` (tokens only) or `full`. */
  tier: string;
  description: string;
  /** Preview image, relative to the theme's own directory; `null` when it ships no artwork. */
  preview: string | null;
  license: string | null;
  homepage: string | null;
  tags: string[];
  /** What the theme relies on the frontend honouring. */
  capabilities: string[];
}

/**
 * One theme as the installed grid lists it. The fields a card or a
 * compatibility check can use without reading `tokens.json`; `license`,
 * `homepage` and `schemaVersion` stay in {@link ThemeManifest}, which
 * {@link ThemeFile} carries.
 */
export interface ThemeSummary {
  id: string;
  name: string;
  author: string;
  version: string;
  themeApi: string;
  minimumLauncherVersion: string;
  tier: string;
  description: string;
  preview: string | null;
  tags: string[];
  capabilities: string[];
}

/**
 * One theme, fully: its manifest and its raw `tokens.json`. The backend
 * flattens the manifest with `#[serde(flatten)]`, so this is not nested at the
 * wire level — it reads as a manifest that happens to carry a `tokens` key.
 */
export type ThemeFile = ThemeManifest & { tokens: unknown };

/**
 * A custom theme as an older build kept it in the frontend's `localStorage`,
 * for the one-time import. Sent, never received; the palettes stay `unknown`
 * because their real shape is {@link ThemeFile}'s `tokens`.
 */
export interface LegacyTheme {
  name: string;
  dark: unknown;
  light: unknown;
  bloom?: number;
  scheme?: string;
}
