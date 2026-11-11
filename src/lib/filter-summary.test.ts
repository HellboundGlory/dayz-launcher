import { describe, expect, it } from "vitest";
import type { ServerFilter } from "@/types/filters";
import { DEFAULT_FILTER } from "@/stores/server-store";
import { activeFilterCount } from "./filter-summary";

const withFilter = (patch: Partial<ServerFilter>): ServerFilter => ({ ...DEFAULT_FILTER, ...patch });

describe("activeFilterCount", () => {
  it.each<{ name: string; patch: Partial<ServerFilter> }>([
    { name: "maps", patch: { maps: ["chernarusplus", "namalsk"] } },
    { name: "countries", patch: { countries: ["EU", "NA"] } },
    { name: "version", patch: { version: "1.29.163709" } },
    { name: "official", patch: { official: true } },
    { name: "first person", patch: { first_person: false } },
    { name: "time of day", patch: { time_of_day: "night" } },
    { name: "modded", patch: { modded: true } },
    { name: "included mods", patch: { mod_ids: ["1", "2"] } },
    { name: "excluded mods", patch: { mod_ids_exclude: ["3"] } },
    { name: "ping", patch: { max_ping: 100 } },
    { name: "hide offline", patch: { hide_offline: true } },
    { name: "hide locked", patch: { hide_locked: true } },
    { name: "battleye", patch: { battleye: true } },
    { name: "hide empty", patch: { hide_empty: true } },
    { name: "hide full", patch: { hide_full: true } },
  ])("counts $name once", ({ patch }) => {
    expect(activeFilterCount(withFilter(patch))).toBe(1);
  });

  it("counts every filter that is on, and mod picks as one", () => {
    const filter = withFilter({
      maps: ["chernarusplus"],
      countries: ["EU"],
      version: "1.29.163709",
      official: false,
      first_person: true,
      time_of_day: "day",
      modded: false,
      mod_ids: ["1"],
      mod_ids_exclude: ["2"],
      max_ping: 50,
      hide_offline: true,
      hide_locked: true,
      battleye: true,
      hide_empty: true,
      hide_full: true,
    });
    expect(activeFilterCount(filter)).toBe(14);
  });

  it("ignores the search text and the Favourites and Recent tabs", () => {
    expect(activeFilterCount(withFilter({ search: "namalsk" }))).toBe(0);
    expect(activeFilterCount(withFilter({ favourites_only: true }))).toBe(0);
    expect(activeFilterCount(withFilter({ recent_only: true }))).toBe(0);
  });

  it("is zero on a fresh filter", () => {
    expect(activeFilterCount(DEFAULT_FILTER)).toBe(0);
  });
});
