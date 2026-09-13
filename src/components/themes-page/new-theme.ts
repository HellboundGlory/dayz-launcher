// The "New theme" choice, decided as data: which of the two create paths a
// pick leads to, and with what arguments. Kept out of the component so the
// mapping (and the guard against naming a template this build does not ship)
// is testable without rendering anything.
import { slugify } from "@/theme/theme-store";
import type { ThemeSummary } from "@/types/theme";

/**
 * The tiers in the order they build on each other — the order a starter set is
 * meant to be read in, which id-alphabetical (`starter.advanced`, `starter.basic`)
 * is not. Unknown tiers sort last rather than being dropped, so a template this
 * build does not recognise still appears.
 */
const TIER_RANK: Record<string, number> = { basic: 0, advanced: 1, expert: 2 };

/** The templates in tier order, for the picker. */
export function byTier(templates: ThemeSummary[]): ThemeSummary[] {
  const rank = (template: ThemeSummary) => TIER_RANK[template.tier] ?? Number.MAX_SAFE_INTEGER;
  return [...templates].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export type NewThemeRequest =
  | { kind: "blank"; sourceId: "neutral"; name: string }
  | { kind: "template"; templateId: string; newId: string; name: string };

/**
 * What creating a theme called `name` from `choice` should call, or `null` when
 * `choice` names no template `templates` actually has — a stale pick from a list
 * fetched before the app's resources changed must do nothing, not call the
 * backend with an id it will refuse.
 *
 * `choice` is `"blank"` (the existing duplicate-from-`neutral` path) or a
 * starter template's id.
 *
 * A scaffolded id takes the same `local.<slug>` shape a duplicate does, so both
 * paths produce ids the rest of the store already treats identically.
 */
export function newThemeRequest(
  choice: string,
  name: string,
  templates: ThemeSummary[],
): NewThemeRequest | null {
  if (choice === "blank") return { kind: "blank", sourceId: "neutral", name };
  if (!templates.some((template) => template.id === choice)) return null;
  return { kind: "template", templateId: choice, newId: `local.${slugify(name)}`, name };
}
