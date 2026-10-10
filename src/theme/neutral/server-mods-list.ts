import type { LayoutFile } from "../renderer/types";
import "./server-mods-list.css";

export const SERVER_MODS_LIST: LayoutFile = {
  schemaVersion: 2,
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    children: [
      { element: "serverMod.order" },
      { element: "serverMod.thumbnail" },
      {
        type: "stack",
        direction: "column",
        grow: 1,
        minWidth: "0px",
        children: [
          {
            type: "stack",
            direction: "row",
            align: "center",
            children: [{ element: "serverMod.name" }, { element: "serverMod.unique" }],
          },
          {
            type: "stack",
            direction: "row",
            align: "center",
            children: [
              { element: "serverMod.state" },
              { element: "serverMod.size" },
              { element: "serverMod.progress" },
            ],
          },
        ],
      },
      { element: "serverMod.openInSteam" },
    ],
  },
};
