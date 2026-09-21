import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ColumnDef } from "../renderer/types";
import { parseLengthPx } from "../interaction/resizable";

const DEFAULT_FLOOR = 48;

// Mirrors the fallback used by ../interaction/store.ts: node test environments
// have no `window`, so widths still round-trip within a process.
const memoryStore = new Map<string, string>();

export function columnWidthsKey(themeId: string, listId: string): string {
  return `tetra.columnWidths.v2.${themeId}.${listId}`;
}

function getStorageItem(key: string): string | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // fallback to in-memory store
  }
  return memoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }
  } catch {
    // fallback to in-memory store
  }
  memoryStore.set(key, value);
}

export function isColumnResizable(col: ColumnDef): boolean {
  return col.resizable !== false && /^\d+(?:\.\d+)?px$/.test(col.width ?? "");
}

export function columnFloor(col: ColumnDef): number {
  return parseLengthPx(col.minWidth, DEFAULT_FLOOR);
}

export function parseStoredWidths(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function getStoredWidths(themeId: string, listId: string): Record<string, number> {
  return parseStoredWidths(getStorageItem(columnWidthsKey(themeId, listId)));
}

export function setStoredWidths(
  themeId: string,
  listId: string,
  widths: Record<string, number>,
): void {
  setStorageItem(columnWidthsKey(themeId, listId), JSON.stringify(widths));
}

/** Applies stored overrides over declared widths: unknown ids and non-resizable
 * columns are left untouched, and every override is clamped to its floor. */
export function mergeColumnWidths(
  columns: ColumnDef[],
  overrides: Record<string, number>,
): ColumnDef[] {
  return columns.map((col) => {
    if (!isColumnResizable(col)) return col;
    const stored = overrides[col.id];
    if (typeof stored !== "number" || !Number.isFinite(stored)) return col;
    const width = `${Math.max(columnFloor(col), Math.round(stored))}px`;
    return width === col.width ? col : { ...col, width };
  });
}

export function clearColumnWidthMemory(): void {
  memoryStore.clear();
}

export interface UseColumnWidthsResult {
  columns: ColumnDef[];
  startResize: (e: ReactPointerEvent, columnId: string) => void;
  resetColumn: (columnId: string) => void;
  resetAll: () => void;
}

export function useColumnWidths(
  themeId: string,
  listId: string,
  columns: ColumnDef[],
): UseColumnWidthsResult {
  const key = columnWidthsKey(themeId, listId);
  const [overrides, setOverrides] = useState<Record<string, number>>(() =>
    getStoredWidths(themeId, listId),
  );

  useEffect(() => {
    setOverrides(getStoredWidths(themeId, listId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  const drag = useRef<{ columnId: string; startX: number; startWidth: number; floor: number } | null>(
    null,
  );

  const persist = useCallback(
    (next: Record<string, number>) => {
      setStoredWidths(themeId, listId, next);
    },
    [themeId, listId],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const next = Math.max(d.floor, Math.round(d.startWidth + (e.clientX - d.startX)));
      setOverrides((prev) => (prev[d.columnId] === next ? prev : { ...prev, [d.columnId]: next }));
    }
    function onUp() {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persist(overridesRef.current);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [persist]);

  const startResize = useCallback(
    (e: ReactPointerEvent, columnId: string) => {
      const col = columns.find((c) => c.id === columnId);
      if (!col || !isColumnResizable(col)) return;
      e.preventDefault();
      e.stopPropagation();
      const floor = columnFloor(col);
      const startWidth = overridesRef.current[columnId] ?? parseLengthPx(col.width, floor);
      drag.current = { columnId, startX: e.clientX, startWidth, floor };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [columns],
  );

  const resetColumn = useCallback(
    (columnId: string) => {
      const prev = overridesRef.current;
      if (!(columnId in prev)) return;
      const next = { ...prev };
      delete next[columnId];
      setOverrides(next);
      persist(next);
    },
    [persist],
  );

  const resetAll = useCallback(() => {
    setOverrides({});
    persist({});
  }, [persist]);

  return {
    columns: mergeColumnWidths(columns, overrides),
    startResize,
    resetColumn,
    resetAll,
  };
}
