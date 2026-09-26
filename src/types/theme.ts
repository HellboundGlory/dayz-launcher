/**
 * IPC shapes for the theme commands, hand-kept in sync with the Rust structs
 * in `src-tauri/src/theme/{mod,manifest}.rs` — no codegen in this repo.
 * `Option<T>` fields are `| null`, matching how the backend serialises them.
 */

export interface ThemePreview {
  file: string;
  caption: string;
}

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
  description: string;
  preview: string | null;
  license: string | null;
  homepage: string | null;
  tags: string[];
  capabilities: string[];
  incompatible?: boolean;
  incompatibleReason?: string | null;
  previews?: ThemePreview[];
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
  incompatible?: boolean;
  incompatibleReason?: string | null;
  previews?: ThemePreview[];
}

import type { LayoutFile } from "@/theme/renderer/types";

/** One theme, fully. The backend flattens the manifest, so this isn't nested at the wire level. */
export type ThemeFile = ThemeManifest & {
  tokens: unknown;
  settingsSchema: unknown | null;
  /** Keyed by package-relative path (`layout/shell.json`) — absent when the theme ships none. */
  layouts?: Record<string, LayoutFile>;
  /** Files the backend dropped from `layouts` for failing validation, with the issues that dropped them. */
  fallbacks: ValidationIssue[];
};

/** A custom theme as an older build kept it in `localStorage`, for the one-time import. */
export interface LegacyTheme {
  name: string;
  dark: unknown;
  light: unknown;
  bloom?: number;
  scheme?: string;
}

/** The pending theme activation, as the backend reports it. */
export interface ActivationStatus {
  previousId: string | null;
  newId: string | null;
  remainingMs: number;
}

/** What a validated theme package would install. Mirrors `theme::archive::ThemeImportPreview`. */
export interface ThemeImportPreview {
  /** Directory under `themes/.staging/` that the install step consumes. */
  stagingId: string;
  manifest: ThemeManifest;
  packageSizeBytes: number;
  fileCount: number;
  /** `new`, `update`, `same_version` or `downgrade`. */
  classification: string;
}

/** Manifest fields an export dialog may edit before packaging. Mirrors `theme::archive::ManifestOverrides` — every field `None`/omitted exports the installed value unchanged. */
export interface ManifestOverrides {
  name?: string;
  author?: string;
  version?: string;
  description?: string;
  tags?: string[];
  license?: string;
  homepage?: string;
}

/** Mirrors the Rust `Severity` in `theme::validator::issue`, which serialises lowercase. */
export type ValidationSeverity = "error" | "warning";

/** One finding from `validate_theme` or a Dev Mode check. Mirrors `theme::validator::issue::ValidationIssue`. */
export interface ValidationIssue {
  ruleId: string;
  severity: ValidationSeverity;
  /** Package-relative file the issue is in, e.g. "layout/shell.json". */
  file: string;
  /** RFC 6901 pointer to the offending node; "" when the whole file is the subject. */
  pointer: string;
  message: string;
  hint?: string;
}
