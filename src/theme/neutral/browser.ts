import type { LayoutFile } from "../renderer/types";
import "./browser.css";
import "./filter-popups.css";

export const BROWSER_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    height: "100%",
    grow: 1,
    children: [
      { surface: "surface.filterBar" },
      {
        type: "stack",
        direction: "row",
        grow: 1,
        children: [
          { element: "list.servers", grow: 1 },
          {
            type: "stack",
            id: "r-detail",
            context: "selection",
            direction: "column",
            children: [
              { element: "server.name" },
              { element: "server.address" },
              { element: "server.players" },
              { element: "server.ping" },
              { element: "server.map" },
              { element: "server.gameTime" },
              { element: "server.tags" },
              { element: "list.serverMods" },
              { element: "server.join" },
              { element: "server.actionNotice" },
            ],
          },
        ],
      },
    ],
  },
};
