import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListHeader } from "./list-header";
import type { ColumnDef, SortState } from "./types";

const sampleColumns: ColumnDef[] = [
  { id: "fav", width: "40px", align: "center" },
  { id: "name", label: "Server Name", width: "1fr", sort: "name" },
  { id: "players", label: "Players", width: "80px", sort: "players", align: "end" },
  { id: "ping", label: "Ping", width: "60px", sort: "ping", align: "end" },
];

describe("ListHeader", () => {
  it("renders columns with labels and alignment classes", () => {
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} />);

    expect(html).toContain('data-part="header"');
    expect(html).toContain('data-column="fav"');
    expect(html).toContain('data-column="name"');
    expect(html).toContain("Server Name");
    expect(html).toContain("justify-center");
    expect(html).toContain("justify-end");
  });

  it("wraps each heading's text in a label part", () => {
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} />);

    expect(html).toContain('data-part="label"');
  });

  it("renders a descending sort indicator part and aria-sort", () => {
    const sortState: SortState = { key: "name", direction: "descending" };
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} sortState={sortState} />);

    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('data-part="sortIndicator"');
    expect(html).toContain("↓");
    expect(html).toContain('aria-sort="none"'); // for players and ping
  });

  it("renders an ascending sort indicator", () => {
    const sortState: SortState = { key: "name", direction: "ascending" };
    const html = renderToStaticMarkup(<ListHeader columns={sampleColumns} sortState={sortState} />);

    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("↑");
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

  it("renders no handle at all when no onResizeStart is supplied", () => {
    const html = renderToStaticMarkup(<ListHeader columns={resizableColumns} />);
    expect(html).not.toContain('data-part="resizeHandle"');
  });

  it("renders a handle only for px-width columns with resizable !== false", () => {
    const html = renderToStaticMarkup(
      <ListHeader columns={resizableColumns} onResizeStart={() => {}} onResizeReset={() => {}} />,
    );

    const matches = html.match(/data-part="resizeHandle"/g) ?? [];
    expect(matches).toHaveLength(1);
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
