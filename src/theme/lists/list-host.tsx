import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type WheelEvent,
} from "react";
import { observeElementRect, useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { ListHeader } from "./list-header";
import { ListRow } from "./list-row";
import { handleListKeyDown } from "./keyboard";
import { fitColumns, useColumnWidths } from "./use-column-widths";
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

// Widths are re-derived on every render; rows memoise on column identity, so
// an equal-but-fresh array must not become a new prop.
export function sameColumns(a: ColumnDef[], b: ColumnDef[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((col, i) => {
    const other = b[i];
    if (col === other) return true;
    const keys = Object.keys(col) as (keyof ColumnDef)[];
    return keys.length === Object.keys(other).length && keys.every((key) => col[key] === other[key]);
  });
}

const PX_LENGTH = /^(\d+(?:\.\d+)?)px$/;

/** The scroller's minimum width: fixed tracks plus flexible tracks' `minWidth` floors. */
function pxColumnWidthSum(columns: ColumnDef[] = []): number {
  return columns.reduce((sum, col) => {
    const fixed = PX_LENGTH.exec(col.width ?? "");
    if (fixed) return sum + Number.parseFloat(fixed[1]);
    const floor = PX_LENGTH.exec(col.minWidth ?? "");
    return floor ? sum + Number.parseFloat(floor[1]) : sum;
  }, 0);
}

// Port of `scrollHorizontally` from the pre-overhaul server-table: a normal
// vertical wheel redirected sideways, only once there's something to scroll.
function scrollElementHorizontally(el: HTMLDivElement, deltaY: number): boolean {
  if (el.scrollWidth <= el.clientWidth) return false;
  el.scrollLeft += deltaY;
  return true;
}

// A theme that leaves the list's height unbounded must not make it mount every row.
export function observeBoundedRect(
  instance: Virtualizer<HTMLDivElement, Element>,
  cb: (rect: { width: number; height: number }) => void,
) {
  return observeElementRect(instance, (rect) => {
    const cap = instance.targetWindow?.innerHeight;
    cb({ width: rect.width, height: cap ? Math.min(rect.height, cap) : rect.height });
  });
}

/** The state list a row renders: selection first, stripe last, joined so a memoised row sees a value. */
export function rowStates<T>(
  item: T,
  isSelected: boolean,
  index: number,
  computeRowStates?: (item: T, isSelected: boolean) => string[],
): string {
  const custom = computeRowStates ? computeRowStates(item, isSelected) : [];
  const states = isSelected && !custom.includes("selected") ? ["selected", ...custom] : custom;
  // Parity comes from the item index: virtual rows mount mid-list, so :nth-child can't stripe them.
  return (index % 2 === 1 ? [...states, "even"] : states).join(" ");
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
    columns: resizedColumns,
    startResize,
    resetColumn,
  } = useColumnWidths(activeThemeId, listId, columns ?? []);
  const [availableWidth, setAvailableWidth] = useState(0);
  const derivedColumns = isScroll ? fitColumns(resizedColumns, availableWidth) : resizedColumns;
  const columnsRef = useRef(derivedColumns);
  if (!sameColumns(columnsRef.current, derivedColumns)) columnsRef.current = derivedColumns;
  const effectiveColumns = columnsRef.current;
  const hasColumns = effectiveColumns.length > 0;
  const wrapperMinWidth = isScroll ? pxColumnWidthSum(effectiveColumns) : undefined;

  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!isScroll || !el) return;
    const measure = () => setAvailableWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isScroll]);

  const isVirtualized =
    listId === "list.servers" ||
    listId === "list.mods" ||
    listId === "list.modFilterResults";

  const listDef = REGISTRY.lists[listId];
  const subjectKind = listDef?.subject ?? "server";

  // The sticky header sits inside the scroller, so rows start below it.
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
    observeElementRect: observeBoundedRect,
  });

  const selectedIndex = useMemo(
    () => (selectedItem ? items.indexOf(selectedItem) : -1),
    [items, selectedItem],
  );

  // Rows memoise on prop identity, so the parent's callback is read through a
  // ref: an inline arrow from the parent must not re-render every row.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleRowSelect = useCallback((item: unknown) => {
    onSelectRef.current?.(item as T | null);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    handleListKeyDown({
      event: e,
      itemCount: items.length,
      selectedIndex,
      onSelectIndex: (index) => {
        const target = items[index];
        if (target && index !== selectedIndex) {
          handleRowSelect(target);
          if (isVirtualized) {
            virtualizer.scrollToIndex(index, { align: "auto" });
          }
        }
      },
      onClearSelection: () => {
        handleRowSelect(null);
      },
    });
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
              states={rowStates(item, isSelected, virtualRow.index, computeRowStates)}
              onSelect={handleRowSelect}
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
            states={rowStates(item, isSelected, index, computeRowStates)}
            onSelect={handleRowSelect}
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
