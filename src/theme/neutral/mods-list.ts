import type { LayoutFile } from "../renderer/types";

export const MODS_LIST: LayoutFile = {
  schemaVersion: 2,
  estimatedRowHeight: "54px",
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    class: "t-neutral-modrow-row",
    children: [
      { element: "mod.select", class: "t-neutral-modrow-select" },
      { element: "mod.thumbnail", class: "t-neutral-modrow-thumb" },
      {
        type: "stack",
        direction: "column",
        class: "t-neutral-modrow-main",
        children: [
          {
            type: "stack",
            direction: "row",
            align: "center",
            class: "t-neutral-modrow-title",
            children: [
              { element: "mod.name", class: "t-neutral-modrow-name" },
              { element: "mod.disabledBadge", class: "t-neutral-modrow-disabled" },
            ],
          },
          { element: "mod.tags", class: "t-neutral-modrow-tags" },
        ],
      },
      { element: "mod.status", class: "t-neutral-modrow-status" },
      { element: "mod.size", class: "t-neutral-modrow-size" },
      { element: "mod.updated", class: "t-neutral-modrow-updated" },
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
