// Flag images from country-flag-icons 1.6.20, keyed by their two-letter code.
// `exhaustive` is needed because the package lives under node_modules.
const files = import.meta.glob("../../node_modules/country-flag-icons/3x2/??.svg", {
  eager: true,
  exhaustive: true,
  query: "?url&no-inline",
  import: "default",
}) as Record<string, string>;

export const FLAG_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -4), url]),
);

export function flagUrl(code: string | null): string | null {
  if (!code || !Object.prototype.hasOwnProperty.call(FLAG_URLS, code)) return null;
  return FLAG_URLS[code];
}
