// The one place a theme's relative asset path becomes a URL. The backend
// serves `tetra-theme://<theme id>/<relative path>` read-only (protocol.rs),
// and the CSP only allows that scheme — so every frontend asset reference
// goes through here rather than hand-rolling the string.

export function resolveThemeAsset(themeId: string, relPath: string): string {
  // Per segment: encoding the whole path in one call would encode the
  // separators themselves and collapse the path into one bogus segment.
  const path = relPath
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  // The id is the URL's host; `theme::is_usable_id` already constrains it, but
  // encoding here doesn't rely on that invariant holding.
  return `tetra-theme://${encodeURIComponent(themeId)}/${path}`;
}
