// Applies a theme's own CSS and custom fonts. Both go through the
// `tetra-theme://` protocol rather than inlining anything: the project's CSP
// has no `'unsafe-inline'`, so a `<link>` and a `FontFace` URL are the only
// routes that work.
import { resolveThemeAsset } from "./asset-resolver";

const LINK_ID = "tetra-theme-css";

/** Every `FontFace` this module currently has loaded, so the next call can unload them. */
let loadedFonts: FontFace[] = [];
/** Bumped per call: a font whose `load()` settles after a newer call must not come back. */
let fontGeneration = 0;
/** The arguments the current set was loaded for — `apply()` re-runs on every
 * mutation, and re-loading an unchanged set on each slider tick would drop and
 * re-fetch the fonts mid-drag. */
let loadedFor: string | null = null;

export function applyThemeStylesheet(themeId: string | null, capabilities: string[]): void {
  const existing = document.getElementById(LINK_ID);
  if (themeId === null || !capabilities.includes("css")) {
    existing?.remove();
    return;
  }
  const href = resolveThemeAsset(themeId, "styles.css");
  if (existing !== null) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
    return;
  }
  const link = document.createElement("link");
  link.setAttribute("id", LINK_ID);
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", href);
  document.head.appendChild(link);
}

export function applyThemeFonts(
  themeId: string | null,
  customFonts: { family: string; file: string }[],
): void {
  const key = `${themeId ?? ""}\n${customFonts.map((f) => `${f.family}\n${f.file}`).join("\n")}`;
  if (key === loadedFor) return;
  loadedFor = key;

  const generation = ++fontGeneration;
  for (const face of loadedFonts) document.fonts.delete(face);
  loadedFonts = [];
  if (themeId === null) return;

  for (const font of customFonts) {
    const face = new FontFace(font.family, `url(${resolveThemeAsset(themeId, font.file)})`);
    void face
      .load()
      .then(() => {
        // A superseded call already unloaded this generation.
        if (generation !== fontGeneration) return;
        document.fonts.add(face);
        loadedFonts.push(face);
      })
      .catch((e) => {
        // One bad font file must not stop the rest of the theme applying.
        console.error(`Could not load theme font "${font.family}":`, e);
      });
  }
}
