import type { LayoutFile } from "../renderer/types";

export const BROWSER_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    class: "t-neutral-browser",
    children: [
      {
        type: "stack",
        direction: "row",
        wrap: true,
        class: "t-neutral-browser-filters",
        children: [
          { element: "filter.search", class: "t-neutral-browser-search" },
          { element: "filter.menu", class: "t-neutral-browser-menu" },
          { element: "filter.chips", class: "t-neutral-browser-chips" },
          { element: "filter.sort", class: "t-neutral-browser-dropdown" },
          { element: "servers.addServer", class: "t-neutral-browser-add", options: { display: "icon" } },
          { element: "servers.refresh", class: "t-neutral-browser-refresh" },
        ],
      },
      {
        element: "list.servers",
        options: { header: false, rowGap: "listGap" },
        class: "t-neutral-browser-list",
      },
    ],
  },
};
