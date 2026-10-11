import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListHeader } from "./list-header";
import type { ColumnDef, SortState } from "./types";

describe("ListHeader headerElement", () => {
  it("renders the registry element instead of the column's label and sort button", () => {
    const columns: ColumnDef[] = [
      { id: "select", width: "40px", label: "Select", sort: "name", headerElement: "mods.selectAll" },
    ];
    const html = renderToStaticMarkup(<ListHeader columns={columns} />);

    expect(html).toContain('data-el="mods.selectAll"');
    expect(html).not.toContain(">Select<");
    expect(html).not.toContain("aria-sort");
  });
});

const sampleColumns: ColumnDef[] = [
  { id: "fav", width: "40px", align: "center" },
  { id: "name", label: "Server Name", width: "1fr", sort: "name" },
  { id: "players", label: "Players", width: "80px", sort: "players", align: "end" },
  { id: "ping", label: "Ping", width: "60px", sort: "ping", align: "end" },
];

describe("ListHeader", () => {
  it("exposes header, column and label parts", () => {
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} />);

    expect(html).toContain('data-part="header"');
    expect(html).toContain('data-part="column"');
    expect(html).toContain('data-column="fav"');
    expect(html).toContain('data-column="name"');
    expect(html).toContain('data-part="label">Server Name<');
  });

  it.each([
    { direction: "descending" as const, indicator: "↓" },
    { direction: "ascending" as const, indicator: "↑" },
  ])("marks the sorted column $direction and its indicator part", ({ direction, indicator }) => {
    const sortState: SortState = { key: "name", direction };
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} sortState={sortState} />);

    expect(html).toContain(`aria-sort="${direction}"`);
    expect(html).toContain('data-part="sortIndicator"');
    expect(html).toContain(indicator);
    // The other sortable columns stay unsorted.
    expect(html).toContain('aria-sort="none"');
  });

  it("marks the active sortable heading with data-state=active", () => {
    const sortState: SortState = { key: "players", direction: "descending" };
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} sortState={sortState} />);

    expect(html).toContain('data-state="active"');
  });

  it("accounts for scrollbarWidth in padding", () => {
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} scrollbarWidth={12} />);
    expect(html).toContain("padding-right:calc(var(--t-space-rowX) + 12px)");
  });
});

describe("ListHeader resize handles", () => {
  const resizableColumns: ColumnDef[] = [
    { id: "fav", width: "40px", align: "center" },
    { id: "flex", label: "Name", width: "1fr" },
    { id: "auto", label: "Auto", width: "auto" },
    { id: "locked", label: "Locked", width: "64px", resizable: false },
  ];

  it("renders a handle only for a px-width column that can resize and only with onResizeStart", () => {
    const withoutHandler = renderToStaticMarkup(<ListHeader columns={resizableColumns} />);
    expect(withoutHandler).not.toContain('data-part="resizeHandle"');

    const withHandler = renderToStaticMarkup(
      <ListHeader columns={resizableColumns} onResizeStart={() => {}} onResizeReset={() => {}} />,
    );
    expect(withHandler.match(/data-part="resizeHandle"/g)).toHaveLength(1);
  });

  it("gives the handle a separator role, vertical orientation, and a reset title", () => {
    const html = renderToStaticMarkup(
      <ListHeader columns={resizableColumns} onResizeStart={() => {}} onResizeReset={() => {}} />,
    );

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("Drag to resize");
  });
});
