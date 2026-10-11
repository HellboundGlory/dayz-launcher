import type { LayoutFile, LayoutNode } from "../renderer/types";
import "./shell.css";

function railContent(collapsed: boolean): LayoutNode[] {
  const display = collapsed ? "icon" : "iconLabel";
  const item = (element: string): LayoutNode => ({
    element,
    class: "t-neutral-shell-item",
    options: { display },
  });

  return [
    {
      type: "stack",
      direction: "row",
      align: "center",
      class: "t-neutral-shell-brand",
      children: [{ element: "app.logo", class: "t-neutral-shell-logo", options: { wordmark: !collapsed } }],
    },
    {
      type: "stack",
      direction: "column",
      landmark: "navigation",
      class: "t-neutral-shell-nav",
      children: [item("nav.servers"), item("nav.favourites"), item("nav.recent"), item("nav.mods")],
    },
    {
      type: "stack",
      direction: "column",
      class: "t-neutral-shell-settings",
      children: [item("nav.settings")],
    },
  ];
}

// The toggle sits outside the collapsible body so it keeps focus when the body swaps.
const RAIL: LayoutNode = {
  type: "stack",
  direction: "column",
  landmark: "complementary",
  class: "t-neutral-shell-rail",
  children: [
    {
      type: "stack",
      direction: "column",
      id: "r-sidebar",
      grow: 1,
      class: "t-neutral-shell-rail-body",
      collapsible: {
        collapseBelow: "720px",
        collapsed: {
          type: "stack",
          direction: "column",
          grow: 1,
          children: railContent(true),
        },
      },
      children: railContent(false),
    },
    { element: "app.collapseToggle", class: "t-neutral-shell-toggle", options: { region: "r-sidebar" } },
  ],
};

const TITLE_BAR: LayoutNode = {
  type: "stack",
  direction: "row",
  align: "center",
  class: "t-neutral-shell-titlebar",
  children: [
    { element: "app.dragRegion", grow: 1, class: "t-neutral-shell-drag" },
    { surface: "surface.windowControls", class: "t-neutral-shell-controls" },
  ],
};

const COUNTS: LayoutNode = {
  type: "stack",
  direction: "row",
  align: "center",
  grow: 1,
  class: "t-neutral-shell-counts",
  children: [
    { element: "status.serverTotal", class: "t-neutral-shell-count" },
    { element: "status.populated", class: "t-neutral-shell-count" },
    { element: "status.listSource", class: "t-neutral-shell-count" },
    { element: "status.lastRefreshed", class: "t-neutral-shell-count", options: { label: "refreshed" } },
  ],
};

const FOOTER: LayoutNode = {
  type: "stack",
  direction: "row",
  align: "center",
  landmark: "contentinfo",
  class: "t-neutral-shell-footer",
  children: [
    { element: "status.steam", class: "t-neutral-shell-steam" },
    { type: "box", class: "t-neutral-shell-vrule", children: [] },
    COUNTS,
    { element: "app.uiScale", class: "t-neutral-shell-scale", options: { label: "Scale" } },
    { element: "app.schemeToggle", class: "t-neutral-shell-scheme" },
  ],
};

const CONTENT: LayoutNode = {
  type: "stack",
  direction: "column",
  id: "r-main",
  grow: 1,
  class: "t-neutral-shell-content",
  children: [
    { element: "notice.update" },
    {
      type: "box",
      landmark: "main",
      grow: 1,
      class: "t-neutral-shell-view",
      children: [{ type: "outlet", name: "view" }],
    },
    FOOTER,
  ],
};

export const SHELL_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "row",
    grow: 1,
    class: "t-neutral-shell-root",
    children: [
      RAIL,
      {
        type: "stack",
        direction: "column",
        class: "t-neutral-shell-main",
        children: [TITLE_BAR, CONTENT, { type: "outlet", name: "modals" }],
      },
    ],
  },
};
