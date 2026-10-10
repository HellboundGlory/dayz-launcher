import type { LayoutFile } from "../renderer/types";
import "./shell.css";

export const SHELL_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    height: "100%",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        landmark: "banner",
        children: [
          { element: "app.logo" },
          { surface: "surface.navRail" },
          { element: "app.dragRegion", grow: 1 },
          { surface: "surface.windowControls" },
        ],
      },
      { element: "notice.storage" },
      { element: "notice.error" },
      {
        type: "box",
        id: "r-main",
        landmark: "main",
        grow: 1,
        children: [{ type: "outlet", name: "view" }],
      },
      {
        type: "stack",
        direction: "row",
        align: "center",
        landmark: "contentinfo",
        children: [
          { element: "status.steam" },
          { element: "status.serverTotal" },
          { element: "status.populated" },
          { element: "status.lastRefreshed" },
          { element: "status.listSource" },
        ],
      },
      { type: "outlet", name: "modals" },
    ],
  },
};
