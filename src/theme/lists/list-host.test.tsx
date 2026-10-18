import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyboardEvent } from "react";
import { ListRow, listRowPropsEqual, type ListRowProps } from "./list-row";
import { ListHost, observeBoundedRect, rowStates, sameColumns } from "./list-host";
import { handleListKeyDown } from "./keyboard";
import { clearColumnWidthMemory, setStoredWidths } from "./use-column-widths";
import type { ColumnDef } from "./types";
import type { LayoutNode } from "../renderer/types";
import type { Server } from "@/types/server";

// Server rendering has no scroll element to measure, so the virtualizer gets a viewport to draw rows into.
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) =>
      actual.useVirtualizer({ initialRect: { width: 0, height: 500 }, ...options }),
  };
});

const mockServer: Server = {
  addr: "192.168.1.1",
  game_port: 2302,
  query_port: 27016,
  name: "DayZ Epoch Test",
  map_display: "Chernarus",
  players: 42,
  max_players: 60,
  ping: 35,
  locked: false,
  vac: true,
  version: "1.26",
  in_game_time: "14:30",
  queue: null,
  day_multiplier: 1,
  night_multiplier: 1,
  mod_count: 5,
  country_code: "US",
  last_played: 1700000000,
  favourite: true,
  official: false,
  modded: true,
  first_person: true,
  battleye: true,
  online: true,
};

const sampleColumns: ColumnDef[] = [
  { id: "fav", width: "40px", align: "center" },
  { id: "name", label: "Server Name", width: "1fr", sort: "name" },
  { id: "players", label: "Players", width: "80px", sort: "players", align: "end" },
  { id: "ping", label: "Ping", width: "60px", sort: "ping", align: "end" },
];

describe("ListRow", () => {
  it.each<{ label: string; states: string | string[]; attribute: string }>([
    { label: "an array of states", states: ["selected"], attribute: "selected" },
    { label: "an already-joined state string", states: "selected even", attribute: "selected even" },
  ])("renders default row columns from item properties, given $label", ({ states, attribute }) => {
    const html = renderToStaticMarkup(
      <ListRow columns={sampleColumns} item={mockServer} subjectKind="server" states={states} />,
    );

    expect(html).toContain('data-row=""');
    expect(html).toContain(`data-state="${attribute}"`);
    expect(html).toContain('data-column="name"');
    expect(html).toContain("DayZ Epoch Test");
  });

  it("renders custom row template with server elements resolving subject", () => {
    const html = renderToStaticMarkup(
      <ListRow
        item={mockServer}
        subjectKind="server"
        rowNode={{
          type: "stack",
          direction: "row",
          children: [
            { element: "server.name" },
            { element: "server.players" },
            { element: "server.favourite" },
            { element: "server.tags" },
            { element: "server.join" },
          ],
        }}
      />,
    );

    expect(html).toContain('data-el="server.name"');
    expect(html).toContain("DayZ Epoch Test");
    expect(html).toContain('data-el="server.players"');
    expect(html).toContain("42");
    expect(html).toContain("60");
    expect(html).toContain('data-el="server.favourite"');
    expect(html).toContain('data-state="on"');
    expect(html).toContain('data-el="server.tags"');
    expect(html).toContain('data-state="modded"');
    expect(html).toContain('data-state="firstPerson"');
    expect(html).toContain('data-el="server.join"');
  });

  it("renders mod elements in custom row template", () => {
    const mod = {
      workshop_id: "123",
      title: "Community-Online-Tools",
      state: "needs_update",
      size_on_disk: "10485760",
      time_updated: Math.floor(Date.now() / 1000) - 3600,
      time_added_to_user_list: Math.floor(Date.now() / 1000) - 3600,
      install_timestamp: 0,
      locally_disabled: false,
    };

    const html = renderToStaticMarkup(
      <ListRow
        item={mod}
        subjectKind="mod"
        rowNode={{
          type: "stack",
          direction: "row",
          children: [
            { element: "mod.name" },
            { element: "mod.size" },
            { element: "mod.status" },
            { element: "mod.subscribed" },
          ],
        }}
      />,
    );

    expect(html).toContain('data-el="mod.name"');
    expect(html).toContain("Community-Online-Tools");
    expect(html).toContain('data-el="mod.size"');
    expect(html).toContain('data-el="mod.status"');
    expect(html).toContain(">Update<");
    expect(html).toContain('data-el="mod.subscribed"');
  });
});

describe("ListRow column placement", () => {
  it("derives grid-template-columns from the list's columns when the row grid declares none", () => {
    const html = renderToStaticMarkup(
      <ListRow
        columns={sampleColumns}
        item={mockServer}
        subjectKind="server"
        rowNode={{
          type: "grid",
          children: [{ type: "text", value: mockServer.name, column: "name" }],
        }}
      />,
    );

    expect(html).toContain("grid-template-columns:40px 1fr 80px 60px");
  });

  it("places a column-carrying child at the matching grid-column and aligns its content", () => {
    const html = renderToStaticMarkup(
      <ListRow
        columns={sampleColumns}
        item={mockServer}
        subjectKind="server"
        rowNode={{
          type: "grid",
          children: [{ type: "text", value: String(mockServer.ping), column: "ping" }],
        }}
      />,
    );

    expect(html).toContain("grid-column:4");
    expect(html).not.toContain("justify-self");
    expect(html).toContain("justify-content:flex-end");
    expect(html).toContain("text-align:end");
    expect(html).toContain("min-width:0");
  });

  it.each<{ name: string; child: LayoutNode; gridcell: boolean }>([
    { name: "a host element", child: { element: "server.name", column: "ping" }, gridcell: true },
    { name: "a text leaf", child: { type: "text", value: "42", column: "ping" }, gridcell: true },
    { name: "a stack container", child: { type: "stack", children: [{ type: "text", value: "42" }], column: "ping" }, gridcell: true },
    { name: "a node with no column", child: { type: "text", value: "42" }, gridcell: false },
  ])("marks $name as a gridcell only when it is placed in a column", ({ child, gridcell }) => {
    const html = renderToStaticMarkup(
      <ListRow columns={sampleColumns} item={mockServer} subjectKind="server" rowNode={{ type: "grid", children: [child] }} />,
    );
    expect(html.includes('role="gridcell"')).toBe(gridcell);
  });

  it("floors a cell at its column's declared minWidth", () => {
    const html = renderToStaticMarkup(
      <ListRow
        columns={[
          { id: "name", width: "1fr", minWidth: "96px" },
          { id: "ping", width: "60px" },
        ]}
        item={mockServer}
        subjectKind="server"
        rowNode={{ type: "grid", children: [{ element: "server.name", column: "name" }] }}
      />,
    );

    expect(html).toContain("min-width:96px");
  });

  it("leaves an unknown column id unplaced", () => {
    const html = renderToStaticMarkup(
      <ListRow
        columns={sampleColumns}
        item={mockServer}
        subjectKind="server"
        rowNode={{
          type: "grid",
          children: [{ type: "text", value: "orphan", column: "does-not-exist" }],
        }}
      />,
    );

    expect(html).not.toContain("grid-column");
  });
});

describe("row memoisation", () => {
  const items = [mockServer, { ...mockServer }, { ...mockServer }, { ...mockServer }];
  const rowNode: LayoutNode = { type: "stack", direction: "row", children: [{ element: "server.name" }] };
  const onSelect = vi.fn();

  // Props as `ListHost` builds them for one render: every reference that did not
  // change is shared, and the states come from the list's own helper.
  const propsAt = (selectedIndex: number, index: number): ListRowProps => ({
    rowNode,
    columns: sampleColumns,
    item: items[index],
    subjectKind: "server",
    states: rowStates(items[index], index === selectedIndex, index),
    onSelect,
  });

  it("keeps a row's DOM when nothing it renders changed", () => {
    expect(listRowPropsEqual(propsAt(1, 2), propsAt(1, 2))).toBe(true);
  });

  it("changes only the rows whose states moved when the selection moves", () => {
    const changed = items
      .map((_, index) => (listRowPropsEqual(propsAt(1, index), propsAt(3, index)) ? null : index))
      .filter((index) => index !== null);

    expect(changed).toEqual([1, 3]);
  });

  it("keeps a row when the items array is rebuilt around the same item objects", () => {
    const rebuilt = items.slice();
    expect(listRowPropsEqual(propsAt(1, 2), { ...propsAt(1, 2), item: rebuilt[2] })).toBe(true);
  });

  it("re-renders a row whose item, template, columns or callback changed", () => {
    const base = propsAt(1, 2);
    expect(listRowPropsEqual(base, { ...base, item: { ...mockServer } })).toBe(false);
    expect(listRowPropsEqual(base, { ...base, rowNode: { ...rowNode } })).toBe(false);
    expect(listRowPropsEqual(base, { ...base, columns: [...sampleColumns] })).toBe(false);
    expect(listRowPropsEqual(base, { ...base, onSelect: vi.fn() })).toBe(false);
  });

  it("reads an array of states and the equal joined string as the same states", () => {
    const base = propsAt(1, 3);
    expect(
      listRowPropsEqual({ ...base, states: ["selected", "even"] }, { ...base, states: "selected even" }),
    ).toBe(true);
  });
});

describe("rowStates", () => {
  it("merges selection first and the stripe last, joined for the data-state attribute", () => {
    expect(rowStates(mockServer, false, 0)).toBe("");
    expect(rowStates(mockServer, true, 0)).toBe("selected");
    expect(rowStates(mockServer, false, 1)).toBe("even");
    expect(rowStates(mockServer, true, 1)).toBe("selected even");
    expect(rowStates(mockServer, true, 0, () => ["modded", "played"])).toBe("selected modded played");
    expect(rowStates(mockServer, false, 0, () => ["played"])).toBe("played");
    // A caller that already reports "selected" is not duplicated.
    expect(rowStates(mockServer, true, 0, () => ["selected"])).toBe("selected");
  });
});

describe("sameColumns", () => {
  it("sees a rebuilt array with the same content as the same columns", () => {
    expect(sameColumns(sampleColumns, sampleColumns.map((col) => ({ ...col })))).toBe(true);
  });

  it("sees a resized, added or removed column as a change", () => {
    const resized = sampleColumns.map((col) => (col.id === "ping" ? { ...col, width: "80px" } : col));
    expect(sameColumns(sampleColumns, resized)).toBe(false);
    expect(sameColumns(sampleColumns, [...sampleColumns, { id: "map", width: "1fr" }])).toBe(false);
    expect(sameColumns(sampleColumns, sampleColumns.slice(1))).toBe(false);
  });
});

describe("keyboard navigation", () => {
  it("navigates down and up, bounds correctly, and prevents Enter launch", () => {
    const onSelectIndex = vi.fn();
    const onClearSelection = vi.fn();

    const makeEvent = (key: string) =>
      ({
        key,
        preventDefault: vi.fn(),
      }) as unknown as KeyboardEvent<HTMLElement>;

    // ArrowDown from 0
    let ev = makeEvent("ArrowDown");
    handleListKeyDown({
      event: ev,
      itemCount: 5,
      selectedIndex: 0,
      onSelectIndex,
      onClearSelection,
    });
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(onSelectIndex).toHaveBeenCalledWith(1);

    // ArrowUp from 0
    ev = makeEvent("ArrowUp");
    handleListKeyDown({
      event: ev,
      itemCount: 5,
      selectedIndex: 0,
      onSelectIndex,
      onClearSelection,
    });
    expect(onSelectIndex).toHaveBeenCalledWith(0);

    // End
    ev = makeEvent("End");
    handleListKeyDown({
      event: ev,
      itemCount: 5,
      selectedIndex: 0,
      onSelectIndex,
      onClearSelection,
    });
    expect(onSelectIndex).toHaveBeenCalledWith(4);

    // Escape
    ev = makeEvent("Escape");
    handleListKeyDown({
      event: ev,
      itemCount: 5,
      selectedIndex: 2,
      onSelectIndex,
      onClearSelection,
    });
    expect(onClearSelection).toHaveBeenCalled();

    // Enter prevented
    ev = makeEvent("Enter");
    handleListKeyDown({
      event: ev,
      itemCount: 5,
      selectedIndex: 2,
      onSelectIndex,
      onClearSelection,
    });
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});

describe("ListHost", () => {
  beforeEach(() => {
    clearColumnWidthMemory();
  });

  it("renders empty state when items list is empty", () => {
    const html = renderToStaticMarkup(
      <ListHost
        listId="list.servers"
        items={[]}
        columns={sampleColumns}
        emptyNode={{
          type: "text",
          value: "No servers found matching filters",
          role: "body",
        }}
      />,
    );

    expect(html).toContain('data-list="servers"');
    expect(html).toContain('data-part="empty"');
    expect(html).toContain("No servers found matching filters");
  });

  it("shows the given empty text when there is no empty node", () => {
    const html = renderToStaticMarkup(
      <ListHost listId="list.servers" items={[]} columns={sampleColumns} emptyText="No servers match the current filters." />,
    );

    expect(html).toContain('data-part="empty"');
    expect(html).toContain("No servers match the current filters.");
  });

  it("clip mode (default) renders without a scroll wrapper", () => {
    const html = renderToStaticMarkup(
      <ListHost listId="list.servers" items={[mockServer]} columns={sampleColumns} />,
    );

    expect(html).not.toContain('data-part="headerSticky"');
  });

  it("scroll mode puts the header inside the scroller and sizes the wrapper to the columns", () => {
    const scrollColumns: ColumnDef[] = [
      { id: "star", width: "32px", align: "center" },
      { id: "name", label: "Server Name", width: "420px" },
      { id: "trailing", width: "1fr" },
    ];
    const html = renderToStaticMarkup(
      <ListHost listId="list.servers" items={[mockServer]} columns={scrollColumns} overflowX="scroll" />,
    );

    expect(html).toContain('data-part="headerSticky"');
    expect(html).toContain("sticky");
    expect(html).toContain("min-width:452px");

    // A flexible column adds its minWidth floor instead of nothing.
    const flooredColumns: ColumnDef[] = [
      { id: "star", width: "32px", align: "center" },
      { id: "name", label: "Server Name", width: "1fr", minWidth: "96px" },
      { id: "trailing", width: "auto" },
    ];
    const flooredHtml = renderToStaticMarkup(
      <ListHost listId="list.servers" items={[mockServer]} columns={flooredColumns} overflowX="scroll" />,
    );

    expect(flooredHtml).toContain("min-width:128px");
  });

  it("passes a parsed estimatedRowHeight through to the virtualizer's row estimate", () => {
    const html = renderToStaticMarkup(
      <ListHost
        listId="list.servers"
        items={[mockServer, mockServer]}
        columns={sampleColumns}
        estimatedRowHeight="37px"
      />,
    );

    expect(html).toContain("height:74px");
  });

  it("draws a row that is not loaded yet as an empty spacer", () => {
    const html = renderToStaticMarkup(
      <ListHost
        listId="list.servers"
        items={[mockServer, undefined, { ...mockServer, addr: "192.168.1.2" }]}
        columns={sampleColumns}
      />,
    );

    expect(html.match(/data-row=""/g)).toHaveLength(2);
    expect(html).toContain('<div aria-hidden="true" style="height:44px"></div>');
  });
});

describe("ListHost column widths", () => {
  beforeEach(() => {
    clearColumnWidthMemory();
  });

  it("gives the header the stored grid template and its resize handles", () => {
    setStoredWidths("neutral", "list.servers", { players: 200 });

    const html = renderToStaticMarkup(<ListHost listId="list.servers" items={[]} columns={sampleColumns} />);

    expect(html.match(/grid-template-columns:40px 1fr 200px 60px/g)).toHaveLength(1);
    // fav (40px), players (80px) and ping (60px) are resizable; name (1fr) is not.
    expect(html.match(/data-part="resizeHandle"/g)).toHaveLength(3);
  });
});

describe("observeBoundedRect", () => {
  it("caps an unbounded scroller's height at the window height", () => {
    const cb = vi.fn();
    const instance = {
      scrollElement: { offsetWidth: 900, offsetHeight: 1_480_000 },
      targetWindow: { innerHeight: 800 },
    } as unknown as Parameters<typeof observeBoundedRect>[0];
    observeBoundedRect(instance, cb);
    expect(cb).toHaveBeenCalledWith({ width: 900, height: 800 });
  });

  it("leaves a bounded scroller's height alone", () => {
    const cb = vi.fn();
    const instance = {
      scrollElement: { offsetWidth: 900, offsetHeight: 500 },
      targetWindow: { innerHeight: 800 },
    } as unknown as Parameters<typeof observeBoundedRect>[0];
    observeBoundedRect(instance, cb);
    expect(cb).toHaveBeenCalledWith({ width: 900, height: 500 });
  });
});
