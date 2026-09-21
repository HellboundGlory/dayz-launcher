import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyboardEvent } from "react";
import { ListRow } from "./list-row";
import { ListHost, observeBoundedRect } from "./list-host";
import { handleListKeyDown } from "./keyboard";
import { clearColumnWidthMemory, setStoredWidths } from "./use-column-widths";
import type { ColumnDef } from "./types";
import type { Server } from "@/types/server";

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
  it("renders default row columns from item properties", () => {
    const html = renderToStaticMarkup(
      <ListRow
        columns={sampleColumns}
        item={mockServer}
        subjectKind="server"
        states={["selected"]}
      />,
    );

    expect(html).toContain('data-row=""');
    expect(html).toContain('data-state="selected"');
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
      id: "123",
      name: "Community-Online-Tools",
      status: "Updated",
      size: 10485760,
      updated: "Yesterday",
      author: "Arkensor",
      subscribed: true,
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
    expect(html).toContain("Updated");
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

  it("renders non-virtualized lists (list.serverMods)", () => {
    const html = renderToStaticMarkup(
      <ListHost
        listId="list.serverMods"
        items={[mockServer]}
        columns={sampleColumns}
        selectedItem={mockServer}
      />,
    );

    expect(html).toContain('data-list="serverMods"');
    expect(html).toContain('data-state="selected"');
    expect(html).toContain("DayZ Epoch Test");
  });

  it("clip mode (default) renders without a scroll wrapper", () => {
    const html = renderToStaticMarkup(
      <ListHost listId="list.serverMods" items={[mockServer]} columns={sampleColumns} />,
    );

    expect(html).not.toContain('data-part="headerSticky"');
  });

  it("scroll mode renders the header inside the scroller with sticky positioning and a px-sum wrapper width", () => {
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
});

describe("ListHost column widths", () => {
  beforeEach(() => {
    clearColumnWidthMemory();
  });

  it("gives the header and rows the same grid template when there is a stored override", () => {
    setStoredWidths("neutral", "list.serverMods", { players: 200 });

    const html = renderToStaticMarkup(
      <ListHost
        listId="list.serverMods"
        items={[mockServer]}
        columns={sampleColumns}
        rowNode={{
          type: "grid",
          children: [{ type: "text", value: String(mockServer.players), column: "players" }],
        }}
      />,
    );

    expect(html).toContain("grid-template-columns:40px 1fr 200px 60px");
    // Only one grid-template-columns should appear across header + row.
    expect(html.match(/grid-template-columns:40px 1fr 200px 60px/g)).toHaveLength(2);
  });

  it("clamps a stored override below the column's floor", () => {
    setStoredWidths("neutral", "list.serverMods", { players: 1 });

    const html = renderToStaticMarkup(
      <ListHost listId="list.serverMods" items={[mockServer]} columns={sampleColumns} />,
    );

    // No declared minWidth on "players" in sampleColumns, so the floor is 48px.
    expect(html).toContain("grid-template-columns:40px 1fr 48px 60px");
  });

  it("renders a resize handle only for the resizable px column", () => {
    const html = renderToStaticMarkup(
      <ListHost listId="list.serverMods" items={[mockServer]} columns={sampleColumns} />,
    );

    const matches = html.match(/data-part="resizeHandle"/g) ?? [];
    // fav (40px), players (80px) and ping (60px) are resizable; name (1fr) is not.
    expect(matches).toHaveLength(3);
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
