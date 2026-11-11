import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ServerFilter } from "@/types/filters";
import { DEFAULT_FILTER } from "@/stores/server-store";
import type { SearchSuggestion } from "@/lib/tauri";
import { nextActive, SearchSuggestions, splitMatch, suggestionPatch } from "./search-suggestions";
import { expectRegistryCovers } from "./test-helpers";

const withFilter = (patch: Partial<ServerFilter>): ServerFilter => ({ ...DEFAULT_FILTER, ...patch });

const suggestion = (patch: Partial<SearchSuggestion>): SearchSuggestion => ({
  kind: "map",
  label: "Namalsk",
  count: 1214,
  values: ["namalsk"],
  ...patch,
});

describe("suggestionPatch", () => {
  const rows: {
    name: string;
    suggestion: SearchSuggestion;
    patch: Partial<ServerFilter>;
  }[] = [
    {
      name: "map",
      suggestion: suggestion({ kind: "map", values: ["namalsk"] }),
      patch: { maps: ["namalsk"] },
    },
    {
      name: "mod",
      suggestion: suggestion({ kind: "mod", values: ["1559212036"] }),
      patch: { mod_ids: ["1559212036"] },
    },
    {
      name: "version",
      suggestion: suggestion({ kind: "version", values: ["1.29.163709", "1.29"] }),
      patch: { version: "1.29.163709" },
    },
  ];

  it.each(rows)("adds a $name pick as its filter", ({ suggestion: picked, patch }) => {
    expect(suggestionPatch(withFilter({}), picked)).toEqual({ ...patch, search: null });
  });

  it("adds a map to the maps already picked", () => {
    const filter = withFilter({ maps: ["chernarusplus"] });
    expect(suggestionPatch(filter, suggestion({ values: ["namalsk"] }))).toEqual({
      maps: ["chernarusplus", "namalsk"],
      search: null,
    });
  });

  it("does not add a pick twice", () => {
    const filter = withFilter({ mod_ids: ["1559212036"] });
    expect(suggestionPatch(filter, suggestion({ kind: "mod", values: ["1559212036"] }))).toEqual({
      mod_ids: ["1559212036"],
      search: null,
    });
  });

  it("keeps a version pick's first value only", () => {
    expect(suggestionPatch(withFilter({}), suggestion({ kind: "version", values: ["1.29.163709"] })).version).toBe(
      "1.29.163709",
    );
  });

  it("takes a picked mod off the excluded list", () => {
    const filter = withFilter({ mod_ids_exclude: ["1559212036", "2"] });
    expect(suggestionPatch(filter, suggestion({ kind: "mod", values: ["1559212036"] }))).toEqual({
      mod_ids: ["1559212036"],
      mod_ids_exclude: ["2"],
      search: null,
    });
  });

  it("adds one id of a mod with several when every mod must match", () => {
    const filter = withFilter({ mod_match: "all" });
    expect(suggestionPatch(filter, suggestion({ kind: "mod", values: ["11", "12"] })).mod_ids).toEqual(["11"]);
  });

  it("clears the search text", () => {
    const filter = withFilter({ search: "nam" });
    expect(suggestionPatch(filter, suggestion({})).search).toBeNull();
  });
});

describe("nextActive", () => {
  it.each<{ index: number; key: "ArrowDown" | "ArrowUp"; length: number; next: number }>([
    { index: -1, key: "ArrowDown", length: 4, next: 0 },
    { index: -1, key: "ArrowUp", length: 4, next: 3 },
    { index: 0, key: "ArrowDown", length: 4, next: 1 },
    { index: 3, key: "ArrowDown", length: 4, next: 0 },
    { index: 0, key: "ArrowUp", length: 4, next: 3 },
    { index: 2, key: "ArrowUp", length: 4, next: 1 },
    { index: 0, key: "ArrowDown", length: 1, next: 0 },
  ])("$key from $index of $length goes to $next", ({ index, key, length, next }) => {
    expect(nextActive(index, key, length)).toBe(next);
  });
});

describe("splitMatch", () => {
  it("splits at the typed text", () => {
    expect(splitMatch("Namalsk", "nam")).toEqual({ before: "", match: "Nam", after: "alsk" });
  });

  it("is case-insensitive in what it matches", () => {
    expect(splitMatch("NAMALSK", "nam")).toEqual({ before: "", match: "NAM", after: "ALSK" });
  });

  it("prefers a word start over an earlier mid-word hit", () => {
    expect(splitMatch("Base Namalsk", "nam")).toEqual({ before: "Base ", match: "Nam", after: "alsk" });
  });

  it("accepts a word start after - _ [ ( . and /", () => {
    for (const separator of ["-", "_", "[", "(", ".", "/"]) {
      expect(splitMatch(`Server${separator}Namalsk`, "nam"), separator).toEqual({
        before: `Server${separator}`,
        match: "Nam",
        after: "alsk",
      });
    }
  });

  it("falls back to a mid-word hit when no word start holds", () => {
    expect(splitMatch("Chernamlia", "nam")).toEqual({ before: "Cher", match: "nam", after: "lia" });
  });

  it("finds nothing when the text is absent", () => {
    expect(splitMatch("Livonia", "nam")).toBeNull();
  });

  it("ignores surrounding spaces in the text", () => {
    expect(splitMatch("Namalsk", "  nam  ")).toEqual({ before: "", match: "Nam", after: "alsk" });
  });
});

describe("SearchSuggestions", () => {
  const rows: SearchSuggestion[] = [
    { kind: "map", label: "Namalsk", count: 1214, values: ["namalsk"] },
    { kind: "mod", label: "Namalsk Survival", count: 1190, values: ["1"] },
  ];
  const list = (activeIndex = -1) =>
    renderToStaticMarkup(
      <SearchSuggestions
        triggerRef={{ current: null }}
        text="nam"
        suggestions={rows}
        activeIndex={activeIndex}
        onPick={() => {}}
      />,
    );

  it("shows a row per suggestion with its kind, marked label and count", () => {
    const html = list();
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain(">Map<");
    expect(html).toContain(">Mod<");
    expect(html).toContain('data-part="match"');
    expect(html).toContain("1,214 servers");
    expect(html).toContain("1,190 servers");
  });

  it("marks only the active row", () => {
    expect(list(1)).toMatch(/data-part="suggestion" data-state="active"/);
    expectRegistryCovers(list(1), "filter.search");
    expect(list()).not.toContain('data-state="active"');
  });

  it("closes the hint on the typed text", () => {
    expect(list()).toContain("press Enter to search names for");
    expect(list()).toContain("nam");
  });

  it("renders nothing with no rows", () => {
    expect(
      renderToStaticMarkup(
        <SearchSuggestions triggerRef={{ current: null }} text="nam" suggestions={[]} activeIndex={-1} onPick={() => {}} />,
      ),
    ).toBe("");
  });
});
