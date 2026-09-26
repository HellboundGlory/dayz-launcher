// Applies a theme's stylesheet via the `tetra-theme://` protocol.
import { resolveThemeAsset } from "./asset-resolver";

const LINK_ID = "tetra-theme-css";

export function applyThemeStylesheet(themeId: string | null, capabilities: string[]): void {
  const existing = document.getElementById(LINK_ID);
  if (themeId === null || !capabilities.includes("css")) {
    existing?.remove();
    return;
  }
  const href = resolveThemeAsset(themeId, "styles.css");
  if (existing !== null) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
    if (existing.getAttribute("layer") !== "theme") existing.setAttribute("layer", "theme");
    return;
  }
  const link = document.createElement("link");
  link.setAttribute("id", LINK_ID);
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", href);
  link.setAttribute("layer", "theme");
  document.head.appendChild(link);
}

