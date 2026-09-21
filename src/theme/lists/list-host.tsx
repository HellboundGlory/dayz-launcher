import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type WheelEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ListHeader } from "./list-header";
import { ListRow } from "./list-row";
import { handleListKeyDown } from "./keyboard";
import { useColumnWidths } from "./use-column-widths";
import type { ColumnDef, ListId, SortState } from "./types";
import type { LayoutNode } from "../renderer/types";
import { LayoutNodeRenderer } from "../renderer/node-renderer";
import { REGISTRY } from "../registry";
import { useThemeStore } from "../theme-store";

const DEFAULT_ROW_HEIGHT = 44;

function resolveRowHeight(estimatedRowHeight: number | string): number {
  if (typeof estimatedRowHeight === "number") return estimatedRowHeight;
  const parsed = Number.parseInt(estimatedRowHeight, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_ROW_HEIGHT;
}

function pxColumnWidthSum(columns: ColumnDef[] = []): number {
  return columns.reduce((sum, col) => {
    const match = /^(\d+(?:\.\d+)?)px$/.exec(col.width ?? "");
    return match ? sum + Number.parseFloat(match[1]) : sum;
  }, 0);
}

// Port of `scrollHorizontally` from the pre-overhaul server-table: a normal
// vertical wheel redirected sideways, only once there's something to scroll.
function scrollElementHorizontally(el: HTMLDivElement, deltaY: number): boolean {
  if (el.scrollWidth <= el.clientWidth) return false;
  el.scrollLeft += deltaY;
  return true;
}

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
  estimatedRowHeight?: number | string;
  overflowX?: "clip" | "scroll";
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
  estimatedRowHeight = DEFAULT_ROW_HEIGHT,
  overflowX = "clip",
  className,
  style,
}: ListHostProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const rowHeightPx = resolveRowHeight(estimatedRowHeight);
  const isScroll = overflowX === "scroll";

  const activeThemeId = useThemeStore((s) => s.activeId);
  const {
    columns: effectiveColumns,
    startResize,
    resetColumn,
  } = useColumnWidths(activeThemeId, listId, columns ?? []);
  const hasColumns = effectiveColumns.length > 0;
  const wrapperMinWidth = isScroll ? pxColumnWidthSum(effectiveColumns) : undefined;

  const [headerHeight, setHeaderHeight] = useState(0);

  const isVirtualized =
    listId === "list.servers" ||
    listId === "list.mods" ||
    listId === "list.modFilterResults";

  const listDef = REGISTRY.lists[listId];
  const subjectKind = listDef?.subject ?? "server";

  // The sticky header lives inside the scroller in scroll mode, so its height
  // has to feed the virtualizer as `scrollMargin` — otherwise visible-range
  // maths and `scrollToIndex` both treat row 0 as if it started at the top of
  // the scroll container instead of just below the header.
  useEffect(() => {
    if (!isScroll) {
      setHeaderHeight(0);
      return;
    }
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isScroll, header, hasColumns]);

  const scrollMargin = isScroll ? headerHeight : 0;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeightPx,
    overscan: 5,
    scrollMargin,
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

  const onScrollerWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!e.shiftKey || !scrollRef.current) return;
    if (scrollElementHorizontally(scrollRef.current, e.deltaY)) {
      e.preventDefault();
    }
  };

  const onHeaderWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    if (scrollElementHorizontally(scrollRef.current, e.deltaY)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const headerNode =
    header && hasColumns ? (
      <ListHeader
        columns={effectiveColumns}
        sortState={sortState}
        onSortChange={onSortChange}
        onResizeStart={startResize}
        onResizeReset={resetColumn}
      />
    ) : null;

  const emptyState = (
    <div data-part="empty" className="flex flex-1 items-center justify-center p-8 text-muted">
      {emptyNode ? <LayoutNodeRenderer node={emptyNode} /> : <span>Nothing here</span>}
    </div>
  );

  const rowList = isVirtualized ? (
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
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }}
          >
            <ListRow
              rowNode={rowNode}
              columns={effectiveColumns}
              item={item}
              subjectKind={subjectKind}
              states={getStates(item, isSelected)}
              onSelect={onSelect as (item: unknown) => void}
            />
          </div>
        );
      })}
    </div>
  ) : (
    <>
      {items.map((item, index) => {
        const isSelected = item === selectedItem;
        return (
          <ListRow
            key={index}
            rowNode={rowNode}
            columns={effectiveColumns}
            item={item}
            subjectKind={subjectKind}
            states={getStates(item, isSelected)}
            onSelect={onSelect as (item: unknown) => void}
          />
        );
      })}
    </>
  );

  return (
    <div
      data-list={listName}
      role="grid"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={className ?? "flex h-full w-full flex-col overflow-hidden outline-none"}
      style={style}
    >
      {isScroll ? (
        <div ref={scrollRef} onWheel={onScrollerWheel} className="relative min-h-0 flex-1 overflow-auto">
          <div
            style={{
              minWidth: wrapperMinWidth ? `${wrapperMinWidth}px` : undefined,
              width: "100%",
            }}
          >
            {headerNode && (
              <div
                ref={headerRef}
                data-part="headerSticky"
                onWheel={onHeaderWheel}
                className="sticky top-0 z-10 bg-surface"
              >
                {headerNode}
              </div>
            )}
            {items.length === 0 ? emptyState : rowList}
          </div>
        </div>
      ) : (
        <>
          {headerNode}
          {items.length === 0 ? (
            emptyState
          ) : (
            <div
              ref={scrollRef}
              className={
                isVirtualized
                  ? "relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                  : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
              }
            >
              {rowList}
            </div>
          )}
        </>
      )}
    </div>
  );
}
