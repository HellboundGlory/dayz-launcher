import type { LayoutFile } from "../renderer/types";
import "./mods.css";

export const MODS_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    height: "100%",
    grow: 1,
    children: [
      { element: "notice.modsError" },
      { element: "notice.modsCached" },
      { element: "notice.modsResult" },
      {
        type: "stack",
        direction: "row",
        grow: 1,
        children: [
          { element: "list.mods", grow: 1 },
          {
            type: "stack",
            context: "modSelection",
            direction: "column",
            children: [
              { element: "mod.name" },
              { element: "mod.status" },
              { element: "mod.size" },
              { element: "mod.updated" },
              { element: "mod.subscribed" },
              { element: "mod.update" },
              { element: "mod.openInSteam" },
              { element: "mod.openFolder" },
              { element: "mod.reinstall" },
            ],
          },
        ],
      },
    ],
  },
};
