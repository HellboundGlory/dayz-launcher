import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, useServerStore } from "@/stores/server-store";
import { resetKeepingSearch } from "./filter-menu";

describe("resetKeepingSearch", () => {
  it("clears the filters but keeps the search text and its lookup", () => {
    const lookup = { search: "namalsk" } as never;
    useServerStore.getState().setFilter({ search: "namalsk", hide_empty: true, maps: ["enoch"], favourites_only: false });
    useServerStore.getState().setLookup(lookup);

    resetKeepingSearch();

    const { filter, lookup: after } = useServerStore.getState();
    expect(filter).toEqual({ ...DEFAULT_FILTER, search: "namalsk" });
    expect(after).toBe(lookup);
  });
});
