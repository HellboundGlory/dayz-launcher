import type { LayoutFile } from "../renderer/types";
import "./browser.css";
import "./filter-popups.css";

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
          { element: "filter.map", class: "t-neutral-browser-dropdown" },
          { element: "filter.tags", class: "t-neutral-browser-dropdown" },
          { element: "filter.mods", class: "t-neutral-browser-mods" },
          { element: "filter.region", class: "t-neutral-browser-dropdown" },
          { element: "filter.sort", class: "t-neutral-browser-dropdown" },
          { element: "filter.maxPing", class: "t-neutral-browser-ping" },
          { element: "filter.hideEmpty", class: "t-neutral-browser-toggle" },
          { element: "filter.hideFull", class: "t-neutral-browser-toggle" },
          { element: "filter.hideLocked", class: "t-neutral-browser-toggle" },
          { element: "filter.hideOffline", class: "t-neutral-browser-toggle" },
          { element: "filter.reset", class: "t-neutral-browser-reset" },
          { element: "servers.refresh", class: "t-neutral-browser-refresh" },
        ],
      },
      { element: "notice.launch" },
      { element: "notice.storage" },
      { element: "notice.error" },
      {
        element: "list.servers",
        options: { header: false, rowGap: "listGap" },
        class: "t-neutral-browser-list",
      },
    ],
  },
};
