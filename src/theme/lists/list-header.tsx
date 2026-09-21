import type { CSSProperties } from "react";
import type { ColumnDef, SortState } from "./types";

export function ListHeader({
  columns,
  sortState,
  onSortChange,
  scrollbarWidth = 0,
}: {
  columns: ColumnDef[];
  sortState?: SortState;
  onSortChange?: (key: string) => void;
  scrollbarWidth?: number;
}) {
  const gridTemplate = columns.map((col) => col.width || "auto").join(" ");

  const handleSort = (sortKey?: string) => {
    if (!sortKey || !onSortChange) return;
    onSortChange(sortKey);
  };

  return (
    <div
      data-part="header"
      className="grid w-full select-none items-center border-b border-line bg-surface px-[var(--t-space-rowX)] py-[var(--t-space-controlY)] [font-size:var(--t-type-label-size)] [font-weight:var(--t-type-label-weight)] uppercase text-muted"
      style={{
        gridTemplateColumns: gridTemplate,
        paddingRight: scrollbarWidth > 0 ? `calc(var(--t-space-rowX) + ${scrollbarWidth}px)` : undefined,
      }}
    >
      {columns.map((col) => {
        const isSortable = !!col.sort;
        const isCurrentSort = sortState?.key === col.sort;
        const sortDirection = isCurrentSort ? sortState?.direction : undefined;
        const ariaSort = isCurrentSort ? sortDirection : isSortable ? "none" : undefined;

        const alignClass =
          col.align === "end" ? "justify-end text-right" : col.align === "center" ? "justify-center text-center" : "justify-start text-left";

        const colStyle: CSSProperties = {
          minWidth: col.minWidth,
          maxWidth: col.maxWidth,
        };

        return (
          <div
            key={col.id}
            data-part="column"
            data-column={col.id}
            className={`flex items-center gap-1 min-w-0 ${alignClass}`}
            style={colStyle}
          >
            {isSortable ? (
              <button
                type="button"
                aria-sort={ariaSort}
                data-state={isCurrentSort ? "active" : undefined}
                onClick={() => handleSort(col.sort)}
                className="flex items-center gap-1 hover:text-ink transition-colors"
              >
                <span data-part="label">{col.label ?? col.id}</span>
                {isCurrentSort && (
                  <span data-part="sortIndicator" aria-hidden="true" className="text-accent">
                    {sortDirection === "ascending" ? "↑" : "↓"}
                  </span>
                )}
              </button>
            ) : (
              <span data-part="label">{col.label ?? col.id}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
