import type { LayoutFile } from "../renderer/types";
import "./servers-list.css";

export const SERVERS_LIST: LayoutFile = {
  schemaVersion: 2,
  columns: [
    { id: "favourite", width: "40px" },
    { id: "name", width: "1fr", label: "Server Name", sort: "name" },
    { id: "players", width: "90px", label: "Players", sort: "players" },
    { id: "map", width: "120px", label: "Map", sort: "map" },
    { id: "ping", width: "70px", label: "Ping", sort: "ping" },
    { id: "actions", width: "140px", label: "Actions" },
  ],
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    children: [
      { element: "server.favourite", column: "favourite" },
      {
        type: "stack",
        direction: "column",
        column: "name",
        children: [
          { element: "server.name" },
          { element: "server.tags" },
        ],
      },
      { element: "server.players", column: "players", options: { showCaption: false } },
      { element: "server.map", column: "map" },
      { element: "server.ping", column: "ping", options: { showCaption: false } },
      {
        type: "stack",
        direction: "row",
        column: "actions",
        children: [
          { element: "server.join" },
          { element: "server.actionNotice" },
        ],
      },
    ],
  },
};
