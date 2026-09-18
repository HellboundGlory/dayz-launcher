import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KeyboardEvent } from "react";
import { ListHeader } from "./list-header";
import { ListRow } from "./list-row";
import { ListHost } from "./list-host";
import { handleListKeyDown } from "./keyboard";
import type { ColumnDef, SortState } from "./types";
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

describe("ListHeader", () => {
  it("renders columns with labels and alignment classes", () => {
    const html = renderToStaticMarkup(
      <ListHeader columns={sampleColumns} />,
    );

    expect(html).toContain('data-part="header"');
    expect(html).toContain('data-column="fav"');
    expect(html).toContain('data-column="name"');
    expect(html).toContain("Server Name");
    expect(html).toContain("justify-center");
    expect(html).toContain("justify-end");
  });

  it("renders sort indicators and aria-sort", () => {
    const sortState: SortState = { key: "name", direction: "ascending" };
    const html = renderToStaticMarkup(
      <ListHeader columns={sampleColumns} sortState={sortState} />,
    );

    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("▲");
    expect(html).toContain('aria-sort="none"'); // for players and ping
  });

  it("accounts for scrollbarWidth in padding", () => {
    const html = renderToStaticMarkup(
      <ListHeader columns={sampleColumns} scrollbarWidth={12} />,
    );
    expect(html).toContain("padding-right:calc(var(--t-space-rowX) + 12px)");
  });
});

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
    expect(html).toContain('data-state="favourite"');
    expect(html).toContain('data-el="server.tags"');
    expect(html).toContain('data-state="modded"');
    expect(html).toContain('data-state="1pp"');
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
});
