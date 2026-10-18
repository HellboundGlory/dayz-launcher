import type { LayoutFile, LayoutNode } from "../renderer/types";

function detailRow(label: string, element: string): LayoutNode {
  return {
    type: "stack",
    direction: "row",
    align: "baseline",
    justify: "spaceBetween",
    class: "t-neutral-mods-inspector-row",
    children: [
      { type: "text", value: label, role: "micro", class: "t-neutral-mods-inspector-label" },
      { element, class: "t-neutral-mods-inspector-value" },
    ],
  };
}

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
              {
                type: "stack",
                direction: "column",
                class: "t-neutral-mods-inspector-body",
                children: [
                  {
                    type: "stack",
                    class: "t-neutral-mods-inspector-preview",
                    children: [
                      { element: "mod.thumbnail", class: "t-neutral-mods-inspector-thumb" },
                      {
                        element: "mod.disabledBadge",
                        class: "t-neutral-mods-inspector-badge",
                        position: { anchor: "topLeft", x: "8px", y: "8px" },
                      },
                    ],
                  },
                  { element: "mod.name", class: "t-neutral-mods-inspector-name" },
                  { element: "mod.status", class: "t-neutral-mods-inspector-status" },
                  {
                    element: "mod.tags",
                    class: "t-neutral-mods-inspector-tags",
                    options: { limit: 6, style: "chips" },
                  },
                  { element: "mod.description", class: "t-neutral-mods-inspector-desc", options: { clamp: 6 } },
                  {
                    type: "stack",
                    direction: "column",
                    class: "t-neutral-mods-inspector-details",
                    children: [
                      detailRow("Subscribed", "mod.subscribed"),
                      detailRow("Updated", "mod.updated"),
                      detailRow("Size", "mod.size"),
                      detailRow("Rating", "mod.rating"),
                      detailRow("Workshop id", "mod.workshopId"),
                    ],
                  },
                  {
                    type: "stack",
                    direction: "row",
                    class: "t-neutral-mods-inspector-actions",
                    children: [
                      {
                        element: "mod.update",
                        class: "t-neutral-mods-inspector-btn t-neutral-mods-inspector-update",
                        options: { display: "iconLabel" },
                      },
                      {
                        element: "mod.openInSteam",
                        class: "t-neutral-mods-inspector-btn t-neutral-mods-inspector-open",
                        options: { display: "iconLabel" },
                      },
                      {
                        element: "mod.openFolder",
                        class: "t-neutral-mods-inspector-btn t-neutral-mods-inspector-open t-neutral-mods-inspector-folder",
                        options: { display: "iconLabel" },
                      },
                      {
                        element: "mod.reinstall",
                        class: "t-neutral-mods-inspector-btn t-neutral-mods-inspector-reinstall",
                        options: { display: "iconLabel" },
                      },
                    ],
                  },
                ],
              },
              {
                element: "mod.deselect",
                class: "t-neutral-mods-inspector-close",
                position: { anchor: "topRight", x: "8px", y: "8px" },
              },
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
