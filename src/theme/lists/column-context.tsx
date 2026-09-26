import { createContext, useContext } from "react";
import type { CSSProperties } from "react";
import type { ColumnDef } from "../renderer/types";
import { ALIGN } from "../renderer/props";

export const ListColumnsContext = createContext<ColumnDef[] | undefined>(undefined);

/** Resolves a row child's `column` id against the active row's column list (§7.5).
 * The cell fills its track (grid default); alignment moves to its content so a
 * long value clips instead of shrink-wrapping past the track width. */
export function useColumnPlacement(column: string | undefined): CSSProperties | undefined {
  const columns = useContext(ListColumnsContext);
  if (column === undefined || columns === undefined) return undefined;

  const index = columns.findIndex((col) => col.id === column);
  if (index === -1) return undefined;

  const { align, minWidth } = columns[index];
  // Like the header cell's `minWidth`, this floors the track itself, which is
  // what keeps a `1fr` cell from collapsing to nothing in a narrow list.
  const style: CSSProperties = {
    gridColumn: index + 1,
    minWidth: minWidth ?? 0,
    overflow: "hidden",
  };
  if (align !== undefined) {
    // No `display` here: a grid or stack cell must keep its own.
    style.justifyContent = ALIGN[align];
    style.textAlign = align;
  }
  return style;
}
