// The one place a theme's relative asset path becomes a URL. The backend
// serves `tetra-theme://localhost/<theme id>/<relative path>` read-only
// (protocol.rs), and the CSP only allows that origin — so every frontend asset
// reference goes through here rather than hand-rolling the string.

// WebView2 can't load a custom scheme directly; wry intercepts this http form
// and hands it to the handler as `tetra-theme://localhost/...` (same as Tauri's
// own `convertFileSrc`).
const BASE =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
    ? "http://tetra-theme.localhost"
    : "tetra-theme://localhost";

export function resolveThemeAsset(themeId: string, relPath: string): string {
  // Per segment: encoding the whole path in one call would encode the
  // separators themselves and collapse the path into one bogus segment.
  const path = relPath
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  // The id must stay one segment, so a staged `.staging/<id>` has its `/` encoded.
  return `${BASE}/${encodeURIComponent(themeId)}/${path}`;
}
