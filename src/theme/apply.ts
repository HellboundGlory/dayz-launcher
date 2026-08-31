// Writes the active palette onto document.documentElement.style as CSS
// custom properties — components only ever read var(--token), so switching
// a theme costs one style write and zero re-renders.
import { rgba, type Palette } from "./palette";

export function applyTheme(palette: Palette, scheme: "dark" | "light", bloom: number): void {
  const p = document.documentElement.style;
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
  p.setProperty("--warn", palette.warn);
  p.setProperty("--warn-soft", rgba(palette.warn, 0.14));
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
  const r = (px: number) => `${Math.round(px * bloom * 100) / 100}px`;
  p.setProperty(
    "--glow",
    `0 0 ${r(3)} ${rgba(palette.accent, A(0.95))},` +
      `0 0 ${r(8)} ${rgba(palette.accent, A(0.75))},` +
      `0 0 ${r(18)} ${rgba(palette.accent, A(0.5))},` +
      `0 0 ${r(34)} ${rgba(palette.accent, A(0.3))},` +
      `0 0 ${r(60)} ${rgba(palette.accent, A(0.16))}`,
  );

  // Native form controls (selects, date pickers) follow the OS scheme unless
  // told otherwise — flip them with the theme so the Settings selects render
  // correctly in both modes.
  p.colorScheme = isLight ? "light" : "dark";
}
