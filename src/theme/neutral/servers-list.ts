import type { LayoutFile } from "../renderer/types";
import "./servers-list.css";

export const SERVERS_LIST: LayoutFile = {
  schemaVersion: 2,
  estimatedRowHeight: "48px",
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    class: "t-neutral-servers-row",
    children: [
      { element: "server.favourite", class: "t-neutral-servers-fav" },
      {
        type: "stack",
        direction: "column",
        class: "t-neutral-servers-main",
        children: [
          {
            type: "stack",
            direction: "row",
            align: "center",
            class: "t-neutral-servers-nameline",
            children: [
              { element: "server.tags", class: "t-neutral-servers-tags" },
              { element: "server.name", class: "t-neutral-servers-name" },
            ],
          },
          {
            type: "stack",
            direction: "row",
            align: "center",
            class: "t-neutral-servers-details",
            children: [
              { element: "server.map", class: "t-neutral-servers-mono" },
              { element: "server.gameTime" },
              { element: "server.region", class: "t-neutral-servers-plain", options: { format: "name" } },
              { element: "server.address", class: "t-neutral-servers-mono" },
              { element: "server.lastPlayed", class: "t-neutral-servers-plain", options: { recentOnly: true } },
            ],
          },
        ],
      },
      {
        type: "stack",
        direction: "row",
        align: "center",
        class: "t-neutral-servers-stats",
        children: [
          { element: "server.players", class: "t-neutral-servers-players" },
          { element: "server.ping", class: "t-neutral-servers-ping" },
          { element: "server.modCount", class: "t-neutral-servers-mods" },
        ],
      },
      {
        type: "stack",
        direction: "row",
        align: "center",
        class: "t-neutral-servers-actions",
        children: [
          { element: "server.refresh", class: "t-neutral-servers-refresh" },
          { element: "server.join", class: "t-neutral-servers-join", options: { wording: "fixAndJoin" } },
          { element: "server.menu", class: "t-neutral-servers-menu", options: { icon: "chevronDown" } },
          { element: "server.actionNotice" },
        ],
      },
    ],
  },
};
