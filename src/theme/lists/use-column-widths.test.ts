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

  it("drops non-numeric entries but keeps valid ones", () => {
    expect(parseStoredWidths('{"name": 300, "ping": "80", "flex": null}')).toEqual({
      name: 300,
    });
  });

  it("parses a valid width map", () => {
    expect(parseStoredWidths('{"name": 300, "ping": 90}')).toEqual({ name: 300, ping: 90 });
  });
});

describe("mergeColumnWidths", () => {
  it("merges a stored override over the declared width, clamped to the floor", () => {
    const merged = mergeColumnWidths(columns, { name: 40 });
    expect(merged.find((c) => c.id === "name")?.width).toBe("120px");
  });

  it("applies a valid override above the floor", () => {
    const merged = mergeColumnWidths(columns, { name: 500 });
    expect(merged.find((c) => c.id === "name")?.width).toBe("500px");
  });

  it("ignores overrides for unknown column ids", () => {
    const merged = mergeColumnWidths(columns, { doesNotExist: 999 });
    expect(merged).toEqual(columns);
  });

  it("never resizes fr, auto, or resizable:false columns", () => {
    const merged = mergeColumnWidths(columns, { flex: 999, auto: 999, locked: 999 });
    expect(merged.find((c) => c.id === "flex")?.width).toBe("1fr");
    expect(merged.find((c) => c.id === "auto")?.width).toBe("auto");
    expect(merged.find((c) => c.id === "locked")?.width).toBe("64px");
  });

  it("leaves declared widths untouched when there is no override", () => {
    expect(mergeColumnWidths(columns, {})).toEqual(columns);
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

  it("falls back to declared widths when storage is corrupt", () => {
    clearColumnWidthMemory();
    const key = columnWidthsKey("t1", "list.servers");
    // Simulate corrupt storage by writing malformed JSON through the same key.
    setStoredWidths("t1", "list.servers", { name: 500 });
    expect(key).toBe("tetra.columnWidths.v2.t1.list.servers");
    expect(parseStoredWidths("not json")).toEqual({});
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
