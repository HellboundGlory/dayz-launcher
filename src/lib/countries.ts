import { CONTINENT_OF } from "./continents";

let displayNames: Intl.DisplayNames | null = null;

/** The English short name of a country code, or the code itself when there is no name for it. */
export function countryName(code: string): string {
  try {
    displayNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export interface Continent {
  id: string;
  name: string;
}

export const CONTINENTS: Continent[] = [
  { id: "EU", name: "Europe" },
  { id: "NA", name: "North America" },
  { id: "AS", name: "Asia" },
  { id: "OC", name: "Oceania" },
  { id: "SA", name: "South America" },
  { id: "AF", name: "Africa" },
];

const BY_CONTINENT: Record<string, string[]> = {};
for (const [code, continent] of Object.entries(CONTINENT_OF)) {
  (BY_CONTINENT[continent] ??= []).push(code);
}

/** The continent a country code sits in, or null for the Antarctic codes and anything unknown. */
export function continentOf(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(CONTINENT_OF, code) ? CONTINENT_OF[code] : null;
}

/** The country codes of one continent's table entry, empty for an unknown continent id. */
export function countriesOf(continentId: string): string[] {
  return BY_CONTINENT[continentId] ?? [];
}

/** What the Country row reads: nothing, one name, a whole continent, or a count. */
export function countryDisplayValue(selected: string[]): string {
  if (selected.length === 0) return "Any";
  if (selected.length === 1) return countryName(selected[0]);
  const continent = CONTINENTS.find((c) => countriesOf(c.id).length === selected.length);
  if (continent && selected.every((code) => CONTINENT_OF[code] === continent.id)) return continent.name;
  return `${selected.length} countries`;
}

/** The old five region codes as real country codes, so a filter saved before the change still works. */
export function legacyRegionCountries(region: string): string[] {
  if (!CONTINENTS.some((c) => c.id === region)) return [];
  return countriesOf(region);
}

/** A continent's countries, narrowed to the ones the list shows when given. */
function continentCountries(continentId: string, within?: string[]): string[] {
  const countries = countriesOf(continentId);
  return within ? countries.filter((code) => within.includes(code)) : countries;
}

/** How much of a continent a selection covers: every country, some of them, or none. */
export function continentState(
  selected: string[],
  continentId: string,
  within?: string[],
): "all" | "some" | "none" {
  const countries = continentCountries(continentId, within);
  const count = countries.filter((code) => selected.includes(code)).length;
  if (countries.length === 0 || count === 0) return "none";
  return count === countries.length ? "all" : "some";
}

/** Ticking a continent takes all of its countries, or drops them when all were already picked. */
export function toggleContinent(selected: string[], continentId: string, within?: string[]): string[] {
  const countries = continentCountries(continentId, within);
  const rest = selected.filter((code) => !countries.includes(code));
  return continentState(selected, continentId, within) === "all" ? rest : [...rest, ...countries];
}
