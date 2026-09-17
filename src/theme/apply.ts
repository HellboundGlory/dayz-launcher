// Writes the active palette onto document.documentElement.style as CSS
// custom properties — components only ever read var(--token), so switching
// a theme costs one style write and zero re-renders.
import {
  rgba,
  DEFAULT_RADII,
  DEFAULT_SPACING,
  DEFAULT_TYPOGRAPHY,
  type Palette,
  type Radii,
  type Spacing,
  type Typography,
} from "./palette";
import { resolveTokens, type TokensV2, type TokenValue } from "./tokens";

/** Non-colour design tokens. Same default-and-override shape as a Palette. */
export interface ThemeExtras {
  spacing: Spacing;
  radii: Radii;
  typography: Typography;
  /** Glow strength, 0–1 — what the customiser's "Bloom" slider edits. */
  shadows: { glowIntensity: number };
}

export const DEFAULT_EXTRAS: ThemeExtras = {
  spacing: DEFAULT_SPACING,
  radii: DEFAULT_RADII,
  typography: DEFAULT_TYPOGRAPHY,
  shadows: { glowIntensity: 0.9 },
};

export function applyTheme(
  palette: Palette,
  scheme: "dark" | "light",
  extras: ThemeExtras = DEFAULT_EXTRAS,
  tokens?: Partial<TokensV2>,
): void {
  const p = document.documentElement.style;
  const resolved = resolveTokens(tokens);
  palette = { ...palette, ...tokens?.colors?.[scheme] };
  const bloom = tokens?.bloom ?? extras.shadows.glowIntensity;
  // Base tokens.
  p.setProperty("--bg", palette.bg);
  p.setProperty("--surface", palette.surface);
  p.setProperty("--surface2", palette.surface2);
  p.setProperty("--border", palette.border);
  p.setProperty("--border-weak", rgba(palette.text, 0.1));
  p.setProperty("--text", palette.text);
  p.setProperty("--muted", palette.muted);
  p.setProperty("--muted2", palette.muted2);
  p.setProperty("--muted-soft", rgba(palette.muted2, 0.12));
  p.setProperty("--accent", palette.accent);
  p.setProperty("--accent-soft", rgba(palette.accent, 0.16));
  p.setProperty("--accent-line", rgba(palette.accent, 0.4));
  p.setProperty("--accent2", palette.accent2);
  p.setProperty("--accent2-soft", rgba(palette.accent2, 0.16));
  p.setProperty("--accent2-line", rgba(palette.accent2, 0.4));
  p.setProperty("--success", palette.success);
  p.setProperty("--success-soft", rgba(palette.success, 0.14));
  p.setProperty("--success-line", rgba(palette.success, 0.4));
  p.setProperty("--warn", palette.warn);
  p.setProperty("--warn-soft", rgba(palette.warn, 0.14));
  p.setProperty("--warn-line", rgba(palette.warn, 0.4));
  p.setProperty("--danger", palette.danger);
  p.setProperty("--danger-soft", rgba(palette.danger, 0.15));
  p.setProperty("--danger-line", rgba(palette.danger, 0.4));
  p.setProperty("--row-hover", rgba(palette.text, 0.06));
  p.setProperty("--row-selected", rgba(palette.accent, 0.11));

  // Bloom + the 5-layer glow. Softer glow in light mode so neon doesn't blow
  // out pale surfaces.
  p.setProperty("--bloom", String(bloom));
  const isLight = scheme === "light";
  const A = (a: number) => (isLight ? a * 0.6 : a);
  // Resolved in JS, not calc() — WebKitGTK drops that multiplication and
  // silently kills every glow shadow.
  const r = (px: number) =>
    `${Math.round(px * bloom * 100) / 100}px`;
  p.setProperty(
    "--glow",
    `0 0 ${r(3)} ${rgba(palette.accent, A(0.95))},` +
      `0 0 ${r(8)} ${rgba(palette.accent, A(0.75))},` +
      `0 0 ${r(18)} ${rgba(palette.accent, A(0.5))},` +
      `0 0 ${r(34)} ${rgba(palette.accent, A(0.3))},` +
      `0 0 ${r(60)} ${rgba(palette.accent, A(0.16))}`,
  );

  // Literal values, never calc() — same WebKitGTK constraint as the glow box-shadow above.
  p.setProperty("--space-xs", extras.spacing.xs);
  p.setProperty("--space-sm", extras.spacing.sm);
  p.setProperty("--space-md", extras.spacing.md);
  p.setProperty("--space-lg", extras.spacing.lg);
  p.setProperty("--radius-control", extras.radii.control);
  p.setProperty("--radius-row", extras.radii.row);
  p.setProperty("--radius-chip", extras.radii.chip);
  p.setProperty("--radius-pill", extras.radii.pill);
  p.setProperty("--font-ui", extras.typography.uiFont);
  p.setProperty("--font-data", extras.typography.dataFont);

  const writeScale = (path: string, value: unknown): void => {
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) writeScale(`${path}-${key}`, child);
    } else {
      p.setProperty(path, String(value));
    }
  };
  writeScale("--t", resolved.scales);
  const scales = resolved.scales as Record<string, unknown>;
  for (const [family, roles] of Object.entries(resolved.roles)) {
    for (const [role, value] of Object.entries(roles)) {
      const scale = scales[family] as Record<string, TokenValue | Record<string, TokenValue>> | undefined;
      if (typeof value === "object") {
        for (const [field, step] of Object.entries(value)) {
          const fieldScale = scale?.[field] as Record<string, TokenValue> | undefined;
          p.setProperty(`--t-${family}-${role}-${field}`, String(typeof step === "string" && fieldScale && Object.prototype.hasOwnProperty.call(fieldScale, step) ? fieldScale[step] : step));
        }
      } else {
        // Resolve literals rather than var() references: hairline and glow share scale/role names.
        p.setProperty(`--t-${family}-${role}`, String(typeof value === "string" && scale && Object.prototype.hasOwnProperty.call(scale, value) ? scale[value] : value));
      }
    }
  }

  // Native form controls (selects, date pickers) follow the OS scheme unless
  // told otherwise — flip them with the theme so the Settings selects render
  // correctly in both modes.
  p.colorScheme = isLight ? "light" : "dark";
}
