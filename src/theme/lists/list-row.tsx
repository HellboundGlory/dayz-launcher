import type { MouseEvent, ReactNode } from "react";
import { SubjectContextProvider } from "../elements/context";
import { LayoutNodeRenderer } from "../renderer/node-renderer";
import type { LayoutNode } from "../renderer/types";
import { ListColumnsContext } from "./column-context";
import type { ColumnDef } from "./types";

export function ListRow({
  rowNode,
  columns,
  item,
  subjectKind,
  states = [],
  onSelect,
}: {
  rowNode?: LayoutNode;
  columns?: ColumnDef[];
  item: unknown;
  subjectKind: "server" | "mod" | "serverMod" | "modServer" | "workshopMod";
  states?: string[];
  onSelect?: (item: unknown) => void;
}) {
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    // Only select the row if the click didn't land on an interactive control
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, [data-interactive]")) {
      return;
    }
    onSelect?.(item);
  };

  const stateAttr = states.length > 0 ? states.join(" ") : undefined;
  const gridTemplate = columns?.map((col) => col.width || "auto").join(" ");

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

  if (rowNode) {
    // Theme-declared columns on the row itself win; otherwise derive the
    // track list from the list's own columns so cells line up with the header.
    let effectiveRow = rowNode;
    if ("type" in rowNode && rowNode.type === "grid" && rowNode.columns === undefined && columns && columns.length > 0) {
      effectiveRow = { ...rowNode, columns: columns.map((col) => col.width || "auto") };
    }

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
    <SubjectContextProvider
      subject={{ kind: subjectKind, data: item }}
      contextName="row"
    >
      {renderedContent}
    </SubjectContextProvider>
  );
}
