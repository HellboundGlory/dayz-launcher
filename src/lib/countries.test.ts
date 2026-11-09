import { describe, expect, it } from "vitest";
import {
  CONTINENTS,
  continentOf,
  countriesOf,
  countryDisplayValue,
  countryName,
  continentState,
  legacyRegionCountries,
  toggleContinent,
} from "./countries";
import { FLAG_URLS, flagUrl } from "./country-flag";

describe("countryName", () => {
  it.each([
    ["DE", "Germany"],
    ["US", "United States"],
    ["GB", "United Kingdom"],
    ["XK", "Kosovo"],
    ["XX", "XX"],
  ])("reads %s as %s", (code, name) => {
    expect(countryName(code)).toBe(name);
  });
});

describe("continentOf", () => {
  it.each([
    ["DE", "EU"],
    ["RU", "EU"],
    ["US", "NA"],
    ["NA", "AF"],
    ["AS", "OC"],
    ["SA", "AS"],
    ["AQ", null],
    ["XX", null],
  ])("puts %s in %s", (code, continent) => {
    expect(continentOf(code)).toBe(continent);
  });

  it("covers every flag except the Antarctic ones", () => {
    const antarctic = ["AQ", "BV", "GS", "HM", "TF"];
    const codes = Object.keys(FLAG_URLS).filter((code) => !antarctic.includes(code));
    expect(codes.length).toBeGreaterThan(200);
    expect(codes.filter((code) => continentOf(code) === null)).toEqual([]);
  });
});

describe("countriesOf", () => {
  it("lists the countries of each continent and nothing for an unknown one", () => {
    expect(countriesOf("EU")).toContain("DE");
    expect(countriesOf("EU")).not.toContain("US");
    expect(countriesOf("NA")).toEqual(expect.arrayContaining(["US", "CA", "MX"]));
    expect(countriesOf("ZZ")).toEqual([]);
  });

  it("covers the six continents in order, without the Antarctic codes", () => {
    expect(CONTINENTS.map((c) => c.name)).toEqual([
      "Europe",
      "North America",
      "Asia",
      "Oceania",
      "South America",
      "Africa",
    ]);
    const all = CONTINENTS.flatMap((c) => countriesOf(c.id));
    expect(all).not.toContain("AQ");
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("countryDisplayValue", () => {
  const europe = countriesOf("EU");

  it.each([
    [[], "Any"],
    [["DE"], "Germany"],
    [["DE", "FR"], "2 countries"],
    [europe, "Europe"],
    [[...europe, "US"], `${europe.length + 1} countries`],
  ])("reads %j as %s", (selected, value) => {
    expect(countryDisplayValue(selected)).toBe(value);
  });
});

describe("legacyRegionCountries", () => {
  it("maps the five old region codes to their continents' countries", () => {
    expect(legacyRegionCountries("EU")).toEqual(countriesOf("EU"));
    expect(legacyRegionCountries("AS")).toEqual(countriesOf("AS"));
    expect(legacyRegionCountries("OC")).toEqual(countriesOf("OC"));
    expect(legacyRegionCountries("SA")).toEqual(countriesOf("SA"));
    expect(legacyRegionCountries("NA")).toEqual(countriesOf("NA"));
  });

  it("gives nothing for anything else", () => {
    expect(legacyRegionCountries("DE")).toEqual([]);
    expect(legacyRegionCountries("")).toEqual([]);
  });
});

describe("continents within the listed countries", () => {
  const listed = ["DE", "FR", "US"];

  it("counts a continent as all once every listed country of it is picked", () => {
    expect(continentState(["DE", "FR"], "EU", listed)).toBe("all");
    expect(continentState(["DE"], "EU", listed)).toBe("some");
    expect(continentState(["US"], "EU", listed)).toBe("none");
  });

  it("ticks only the listed countries of a continent, and unticks them again", () => {
    expect(toggleContinent(["US"], "EU", listed).sort()).toEqual(["DE", "FR", "US"]);
    expect(toggleContinent(["DE", "FR", "US"], "EU", listed)).toEqual(["US"]);
  });
});

describe("flagUrl", () => {
  it("gives nothing for keys an object inherits", () => {
    for (const code of ["__proto__", "constructor", "toString", "../DE"]) expect(flagUrl(code)).toBeNull();
  });
});
