import { describe, expect, it } from "vitest";
import {
  clearColumnWidthMemory,
  columnFloor,
  columnWidthsKey,
  fitColumns,
  getStoredWidths,
  isColumnResizable,
  mergeColumnWidths,
  parseStoredWidths,
  setStoredWidths,
} from "./use-column-widths";
import type { ColumnDef } from "../renderer/types";

const columns: ColumnDef[] = [
  { id: "name", width: "420px", minWidth: "120px" },
  { id: "flex", width: "1fr" },
  { id: "auto", width: "auto" },
  { id: "locked", width: "64px", resizable: false },
  { id: "ping", width: "68px" },
];

describe("isColumnResizable", () => {
  it("is true for a px-width column with resizable !== false", () => {
    expect(isColumnResizable(columns[0])).toBe(true);
    expect(isColumnResizable(columns[4])).toBe(true);
  });

  it("is false for fr and auto widths", () => {
    expect(isColumnResizable(columns[1])).toBe(false);
    expect(isColumnResizable(columns[2])).toBe(false);
  });

  it("is false when resizable is explicitly false", () => {
    expect(isColumnResizable(columns[3])).toBe(false);
  });
});

describe("columnFloor", () => {
  it("parses minWidth as px", () => {
    expect(columnFloor(columns[0])).toBe(120);
  });

  it("falls back to 48 when minWidth is absent", () => {
    expect(columnFloor(columns[4])).toBe(48);
  });
});

describe("parseStoredWidths", () => {
  it("returns an empty object for null, malformed JSON, or a non-object payload", () => {
    expect(parseStoredWidths(null)).toEqual({});
    expect(parseStoredWidths("{not json")).toEqual({});
    expect(parseStoredWidths("[1,2,3]")).toEqual({});
    expect(parseStoredWidths('"just a string"')).toEqual({});
  });

  it.each([
    { case: "a valid map", raw: '{"name": 300, "ping": 90}', expected: { name: 300, ping: 90 } },
    { case: "mixed value types", raw: '{"name": 300, "ping": "80", "flex": null}', expected: { name: 300 } },
  ])("parses $case into its numeric entries only", ({ raw, expected }) => {
    expect(parseStoredWidths(raw)).toEqual(expected);
  });
});

describe("mergeColumnWidths", () => {
  it.each([
    { case: "an override below the declared floor", override: 40, width: "120px" },
    { case: "an override above the floor", override: 500, width: "500px" },
  ])("applies $case", ({ override, width }) => {
    const merged = mergeColumnWidths(columns, { name: override });
    expect(merged.find((c) => c.id === "name")?.width).toBe(width);
  });

  it("leaves declared widths untouched when no override applies", () => {
    expect(mergeColumnWidths(columns, {})).toEqual(columns);
    expect(mergeColumnWidths(columns, { doesNotExist: 999 })).toEqual(columns);
  });

  it("never resizes fr, auto, or resizable:false columns", () => {
    const merged = mergeColumnWidths(columns, { flex: 999, auto: 999, locked: 999 });
    expect(merged.find((c) => c.id === "flex")?.width).toBe("1fr");
    expect(merged.find((c) => c.id === "auto")?.width).toBe("auto");
    expect(merged.find((c) => c.id === "locked")?.width).toBe("64px");
  });
});

describe("stored widths round-trip (in-memory fallback)", () => {
  it("persists and retrieves per theme and list", () => {
    clearColumnWidthMemory();
    expect(getStoredWidths("t1", "list.servers")).toEqual({});

    setStoredWidths("t1", "list.servers", { name: 500 });
    expect(getStoredWidths("t1", "list.servers")).toEqual({ name: 500 });
    // A different theme or list is a distinct key.
    expect(getStoredWidths("t2", "list.servers")).toEqual({});
    expect(getStoredWidths("t1", "list.mods")).toEqual({});
  });

  it("keys stored widths by theme and list", () => {
    expect(columnWidthsKey("t1", "list.servers")).toBe("tetra.columnWidths.v2.t1.list.servers");
  });

  it("removing an override via merge leaves the declared width", () => {
    clearColumnWidthMemory();
    setStoredWidths("t1", "list.servers", { name: 500 });
    const overrides = getStoredWidths("t1", "list.servers");
    delete overrides.name;
    const merged = mergeColumnWidths(columns, overrides);
    expect(merged.find((c) => c.id === "name")?.width).toBe("420px");
  });
});

describe("fitColumns", () => {
  const cols: ColumnDef[] = [
    { id: "star", width: "32px", resizable: false },
    { id: "name", width: "420px", minWidth: "120px" },
    { id: "ping", width: "68px", minWidth: "52px" },
    { id: "rest", width: "1fr" },
  ];

  it("leaves columns alone when they already fit", () => {
    expect(fitColumns(cols, 600)).toBe(cols);
  });

  it("shrinks resizable columns in proportion to their slack", () => {
    const fitted = fitColumns(cols, 420);
    // deficit 100 over slack 300 + 16
    expect(fitted.map((c) => c.width)).toEqual(["32px", "325px", "63px", "1fr"]);
  });

  it("stops at the floors and leaves the rest to scrolling", () => {
    const fitted = fitColumns(cols, 100);
    expect(fitted.map((c) => c.width)).toEqual(["32px", "120px", "52px", "1fr"]);
  });

  it("does nothing before the width is known", () => {
    expect(fitColumns(cols, 0)).toBe(cols);
  });
});
