import { createContext, useContext } from "react";
import type { CSSProperties } from "react";
import type { ColumnDef } from "../renderer/types";

export const ListColumnsContext = createContext<ColumnDef[] | undefined>(undefined);

/** Resolves a row child's `column` id against the active row's column list (§7.5). */
export function useColumnPlacement(column: string | undefined): CSSProperties | undefined {
  const columns = useContext(ListColumnsContext);
  if (column === undefined || columns === undefined) return undefined;

  const index = columns.findIndex((col) => col.id === column);
  if (index === -1) return undefined;

  const align = columns[index].align;
  return align === undefined ? { gridColumn: index + 1 } : { gridColumn: index + 1, justifySelf: align };
}
