import type { LayoutFile } from "../renderer/types";

export const SERVER_MODS_LIST: LayoutFile = {
  schemaVersion: 2,
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    class: "t-neutral-servermods-row",
    children: [
      { element: "serverMod.thumbnail", class: "t-neutral-servermods-thumb" },
      {
        type: "stack",
        direction: "column",
        class: "t-neutral-servermods-info",
        children: [
          {
            type: "stack",
            direction: "row",
            align: "center",
            class: "t-neutral-servermods-title",
            children: [
              { element: "serverMod.name", class: "t-neutral-servermods-name" },
              {
                element: "serverMod.unique",
                class: "t-neutral-servermods-unique",
                options: { label: "Unique" },
              },
            ],
          },
          {
            type: "stack",
            direction: "row",
            align: "center",
            class: "t-neutral-servermods-detail",
            children: [
              { element: "serverMod.size", class: "t-neutral-servermods-size" },
              { element: "serverMod.progress", class: "t-neutral-servermods-progress" },
            ],
          },
        ],
      },
      {
        type: "box",
        class: "t-neutral-servermods-badge",
        children: [{ element: "serverMod.state", class: "t-neutral-servermods-state", options: { display: "label" } }],
      },
    ],
  },
};
