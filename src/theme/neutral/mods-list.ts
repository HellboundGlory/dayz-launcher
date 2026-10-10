import type { LayoutFile } from "../renderer/types";
import "./mods-list.css";

export const MODS_LIST: LayoutFile = {
  schemaVersion: 2,
  columns: [
    { id: "name", width: "1fr", label: "Name", sort: "name" },
    { id: "status", width: "120px", label: "Status", sort: "status" },
    { id: "size", width: "100px", label: "Size", sort: "size" },
    { id: "updated", width: "140px", label: "Updated", sort: "updated" },
  ],
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        column: "name",
        children: [
          { element: "mod.select" },
          { element: "mod.name" },
        ],
      },
      { element: "mod.status", column: "status" },
      { element: "mod.size", column: "size" },
      {
        type: "stack",
        direction: "row",
        align: "center",
        column: "updated",
        children: [
          { element: "mod.updated" },
          { element: "mod.subscribed" },
        ],
      },
    ],
  },
};

export const MOD_SERVERS_LIST: LayoutFile = {
  schemaVersion: 2,
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    justify: "spaceBetween",
    children: [
      {
        type: "stack",
        direction: "column",
        children: [
          { element: "modServer.name" },
          { element: "modServer.address" },
        ],
      },
      { element: "modServer.lastPlayed" },
    ],
  },
};
