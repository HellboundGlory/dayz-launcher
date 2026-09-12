/**
 * IPC shapes for the theme commands, hand-kept in sync with the Rust structs
 * in `src-tauri/src/theme/{mod,manifest}.rs` — no codegen in this repo.
 * `Option<T>` fields are `| null`, matching how the backend serialises them.
 */

/** One theme's `theme.json`, as the backend reads and writes it. */
export interface ThemeManifest {
  schemaVersion: number;
  /** Also its directory name under `themes/`. */
  id: string;
  name: string;
  author: string;
  version: string;
  themeApi: string;
  minimumLauncherVersion: string;
  /** `basic` (tokens only) or `full`. */
  tier: string;
  description: string;
  preview: string | null;
  license: string | null;
  homepage: string | null;
  tags: string[];
  capabilities: string[];
}

/** The fields a grid card needs, without reading `tokens.json` for every install. */
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

/** One theme, fully. The backend flattens the manifest, so this isn't nested at the wire level. */
export type ThemeFile = ThemeManifest & { tokens: unknown };

/** A custom theme as an older build kept it in `localStorage`, for the one-time import. */
export interface LegacyTheme {
  name: string;
  dark: unknown;
  light: unknown;
  bloom?: number;
  scheme?: string;
}
