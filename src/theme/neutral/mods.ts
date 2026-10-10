import type { LayoutFile } from "../renderer/types";
import "./mods.css";

export const MODS_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    class: "t-neutral-mods-root",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        class: "t-neutral-mods-toolbar",
        children: [
          { element: "mods.search" },
          { element: "mods.statusFilter", class: "t-neutral-mods-status" },
          { element: "mods.refresh" },
        ],
      },
      { element: "notice.modsError" },
      { element: "notice.modsCached" },
      { element: "notice.modsOutdated" },
      {
        type: "stack",
        direction: "row",
        grow: 1,
        class: "t-neutral-mods-body",
        children: [
          {
            element: "list.mods",
            grow: 1,
            class: "t-neutral-mods-list",
            options: { rowGap: "listGap" },
          },
          {
            type: "stack",
            context: "modSelection",
            direction: "column",
            class: "t-neutral-mods-inspector",
            position: { anchor: "topRight" },
            width: "340px",
            height: "100%",
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
      {
        type: "stack",
        direction: "column",
        class: "t-neutral-mods-actionbar",
        children: [
          { element: "notice.modsResult" },
          {
            type: "stack",
            direction: "row",
            align: "center",
            class: "t-neutral-mods-actions",
            children: [
              { element: "mods.count" },
              { element: "mods.selectAll", class: "t-neutral-mods-select-all", options: { display: "label" } },
              { element: "mods.clearSelection", class: "t-neutral-mods-clear" },
              {
                type: "stack",
                direction: "row",
                align: "center",
                class: "t-neutral-mods-cluster",
                children: [{ element: "mods.selectUnique" }, { element: "mods.cleanupRemoved" }],
              },
              {
                type: "stack",
                direction: "row",
                children: [{ element: "mods.unsubscribe" }, { element: "mods.unsubscribeMenu" }],
              },
              { element: "mods.updateOutdated" },
              {
                type: "stack",
                direction: "row",
                children: [{ element: "mods.verify" }, { element: "mods.verifyMenu" }],
              },
            ],
          },
        ],
      },
    ],
  },
};
