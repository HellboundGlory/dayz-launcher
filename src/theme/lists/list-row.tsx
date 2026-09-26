import { memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { SubjectContextProvider } from "../elements/context";
import { LayoutNodeRenderer } from "../renderer/node-renderer";
import type { LayoutNode } from "../renderer/types";
import { ListColumnsContext } from "./column-context";
import type { ColumnDef } from "./types";

export interface ListRowProps {
  rowNode?: LayoutNode;
  columns?: ColumnDef[];
  item: unknown;
  subjectKind: "server" | "mod" | "serverMod" | "modServer" | "workshopMod";
  /** Already-joined state list, or an array of states to join. */
  states?: string | readonly string[];
  onSelect?: (item: unknown) => void;
}

/**
 * `ListRow`'s memo comparison: a row keeps its DOM only while the item, the
 * template, the columns and the callback stay identical and the states are the
 * same list. New props must be added here.
 */
export function listRowPropsEqual(prev: ListRowProps, next: ListRowProps): boolean {
  const join = (states: ListRowProps["states"]) =>
    typeof states === "string" ? states : (states ?? []).join(" ");
  return (
    prev.item === next.item &&
    prev.rowNode === next.rowNode &&
    prev.columns === next.columns &&
    prev.subjectKind === next.subjectKind &&
    prev.onSelect === next.onSelect &&
    join(prev.states) === join(next.states)
  );
}

function ListRowBase({
  rowNode,
  columns,
  item,
  subjectKind,
  states = [],
  onSelect,
}: ListRowProps) {
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    // Only select the row if the click didn't land on an interactive control
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [data-interactive]")) {
      return;
    }
    onSelect?.(item);
  };

  const stateAttr = (typeof states === "string" ? states : states.join(" ")) || undefined;
  const gridTemplate = columns?.map((col) => col.width || "auto").join(" ");

  const effectiveRow = useMemo(() => {
    if (!rowNode) return undefined;
    // Theme-declared columns on the row itself win; otherwise derive the
    // track list from the list's own columns so cells line up with the header.
    if (
      "type" in rowNode &&
      rowNode.type === "grid" &&
      rowNode.columns === undefined &&
      columns &&
      columns.length > 0
    ) {
      return { ...rowNode, columns: columns.map((col) => col.width || "auto") };
    }
    return rowNode;
  }, [rowNode, columns]);

  // Element hosts read the subject from context; a fresh object per row render
  // would re-render every one of them.
  const subject = useMemo(() => ({ kind: subjectKind, data: item }), [subjectKind, item]);

  const defaultRow = (
    <div
      data-row=""
      data-state={stateAttr}
      role="row"
      onClick={handleClick}
      className="grid w-full items-center border-b border-line px-[var(--t-space-rowX)] py-[var(--t-space-rowY)] transition-colors hover:bg-surface2"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {columns?.map((col) => (
        <div
          key={col.id}
          role="gridcell"
          data-column={col.id}
          className="truncate"
        >
          {String((item as Record<string, unknown>)[col.id] ?? "")}
        </div>
      ))}
    </div>
  );

  let renderedContent: ReactNode = defaultRow;

  if (effectiveRow) {
    renderedContent = (
      <div
        data-row=""
        data-state={stateAttr}
        role="row"
        onClick={handleClick}
        className="w-full transition-colors hover:bg-surface2"
      >
        <ListColumnsContext.Provider value={columns}>
          <LayoutNodeRenderer node={effectiveRow} />
        </ListColumnsContext.Provider>
      </div>
    );
  }

  return (
    <SubjectContextProvider subject={subject} contextName="row">
      {renderedContent}
    </SubjectContextProvider>
  );
}

/** Rows are keyed by index, so unchanged ones must skip the whole subtree. */
export const ListRow = memo(ListRowBase, listRowPropsEqual);
