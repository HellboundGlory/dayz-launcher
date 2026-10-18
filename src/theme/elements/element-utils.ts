import { formatLastPlayed } from "@/lib/utils";

/** Joins an element's states, dropping falsy entries, for its `data-state` attribute. */
export function states(...values: (string | false | null | undefined)[]): string | undefined {
  const active = values.filter(Boolean) as string[];
  return active.length > 0 ? active.join(" ") : undefined;
}

/** Which parts of an element a `display` option shows; values it does not name show neither. */
export function parseDisplay(
  options: Record<string, unknown> | undefined,
  defaultMode: string,
): { showIcon: boolean; showLabel: boolean } {
  const display = (options?.display as string | undefined) ?? defaultMode;
  return {
    showIcon: display === "iconLabel" || display === "icon",
    showLabel: display === "iconLabel" || display === "label",
  };
}

/** Resolves a `display` option into the label and which parts an element renders. */
export function displayOption(
  options: Record<string, unknown> | undefined,
  fallbackLabel: string,
  fallbackDisplay: "iconLabel" | "label" | "icon" = "label",
) {
  const label = (options?.label as string | undefined) ?? fallbackLabel;
  return { label, ...parseDisplay(options, fallbackDisplay) };
}

/** A timestamp element's value: relative time, or a locale date for `format: "date"`. */
export function formatElementTime(unixSeconds: number, format: unknown): string {
  if (format === "date") {
    return new Date(unixSeconds * 1000).toLocaleDateString();
  }
  return formatLastPlayed(unixSeconds);
}
