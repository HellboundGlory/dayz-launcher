import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ListHeader } from "./list-header";
import { ListRow } from "./list-row";
import { handleListKeyDown } from "./keyboard";
import type { ColumnDef, ListId, SortState } from "./types";
import type { LayoutNode } from "../renderer/types";
import { LayoutNodeRenderer } from "../renderer/node-renderer";
import { REGISTRY } from "../registry";

export interface ListHostProps<T = unknown> {
  listId: ListId;
  items: T[];
  columns?: ColumnDef[];
  rowNode?: LayoutNode;
  emptyNode?: LayoutNode;
  header?: boolean;
  selectedItem?: T | null;
  onSelect?: (item: T | null) => void;
  sortState?: SortState;
  onSortChange?: (key: string) => void;
  computeRowStates?: (item: T, isSelected: boolean) => string[];
  estimatedRowHeight?: number;
  className?: string;
  style?: CSSProperties;
}

export function ListHost<T = unknown>({
  listId,
  items,
  columns,
  rowNode,
  emptyNode,
  header = true,
  selectedItem,
  onSelect,
  sortState,
  onSortChange,
  computeRowStates,
  estimatedRowHeight = 44,
  className,
  style,
}: ListHostProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const isVirtualized =
    listId === "list.servers" ||
    listId === "list.mods" ||
    listId === "list.modFilterResults";

  const listDef = REGISTRY.lists[listId];
  const subjectKind = listDef?.subject ?? "server";

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 5,
  });

  const selectedIndex = selectedItem ? items.indexOf(selectedItem) : -1;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    handleListKeyDown({
      event: e,
      itemCount: items.length,
      selectedIndex,
      onSelectIndex: (index) => {
        const target = items[index];
        if (target) {
          onSelect?.(target);
          if (isVirtualized) {
            virtualizer.scrollToIndex(index, { align: "auto" });
          }
        }
      },
      onClearSelection: () => {
        onSelect?.(null);
      },
    });
  };

  const getStates = (item: T, isSelected: boolean) => {
    const custom = computeRowStates ? computeRowStates(item, isSelected) : [];
    if (isSelected && !custom.includes("selected")) {
      return ["selected", ...custom];
    }
    return custom;
  };

  const listName = listId.replace("list.", "");

  return (
    <div
      data-list={listName}
      role="grid"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={className ?? "flex h-full w-full flex-col overflow-hidden outline-none"}
      style={style}
    >
      {header && columns && columns.length > 0 && (
        <ListHeader
          columns={columns}
          sortState={sortState}
          onSortChange={onSortChange}
        />
      )}

      {items.length === 0 ? (
        <div data-part="empty" className="flex flex-1 items-center justify-center p-8 text-muted">
          {emptyNode ? (
            <LayoutNodeRenderer node={emptyNode} />
          ) : (
            <span>Nothing here</span>
          )}
        </div>
      ) : isVirtualized ? (
        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index];
              if (!item) return null;
              const isSelected = item === selectedItem;

              return (
                <div
                  key={virtualRow.index}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListRow
                    rowNode={rowNode}
                    columns={columns}
                    item={item}
                    subjectKind={subjectKind}
                    states={getStates(item, isSelected)}
                    onSelect={onSelect as (item: unknown) => void}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          {items.map((item, index) => {
            const isSelected = item === selectedItem;
            return (
              <ListRow
                key={index}
                rowNode={rowNode}
                columns={columns}
                item={item}
                subjectKind={subjectKind}
                states={getStates(item, isSelected)}
                onSelect={onSelect as (item: unknown) => void}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
