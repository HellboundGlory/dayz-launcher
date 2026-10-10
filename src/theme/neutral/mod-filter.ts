import type { ModalLayoutFile } from "../renderer/types";
import "./mod-filter.css";

export const MOD_FILTER_MODAL: ModalLayoutFile = {
  schemaVersion: 2,
  placement: { mode: "center" },
  backdrop: "dim",
  root: {
    type: "stack",
    direction: "column",
    class: "t-neutral-modfilter",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        justify: "spaceBetween",
        class: "t-neutral-modfilter-header",
        children: [
          {
            type: "stack",
            direction: "column",
            children: [
              { type: "text", role: "heading", value: "Filter by mod", class: "t-neutral-modfilter-title" },
              {
                type: "text",
                role: "label",
                value: "Require or exclude servers by the mods they run",
                class: "t-neutral-modfilter-subtitle",
              },
            ],
          },
          { element: "modal.close", class: "t-neutral-modfilter-close" },
        ],
      },
      { element: "modFilter.source", class: "t-neutral-modfilter-tabs" },
      {
        element: "modFilter.search",
        options: { showIcon: true },
        class: "t-neutral-modfilter-search",
      },
      {
        type: "stack",
        direction: "row",
        class: "t-neutral-modfilter-body",
        children: [
          {
            type: "stack",
            direction: "column",
            class: "t-neutral-modfilter-list",
            children: [{ element: "list.modFilterResults" }],
          },
          {
            type: "stack",
            direction: "column",
            context: "modFilterPreview",
            class: "t-neutral-modfilter-pane",
            empty: {
              type: "stack",
              direction: "column",
              align: "center",
              justify: "center",
              class: "t-neutral-modfilter-pane t-neutral-modfilter-preview-empty",
              children: [
                { type: "image", icon: "inbox", class: "t-neutral-modfilter-preview-empty-icon" },
                {
                  type: "text",
                  role: "body",
                  value: "Click a mod on the left to see its details here.",
                  class: "t-neutral-modfilter-preview-empty-text",
                },
              ],
            },
            children: [
              { element: "workshopMod.thumbnail", class: "t-neutral-modfilter-preview-thumb" },
              {
                type: "stack",
                direction: "row",
                align: "start",
                justify: "spaceBetween",
                class: "t-neutral-modfilter-preview-head",
                children: [
                  {
                    type: "stack",
                    direction: "row",
                    align: "center",
                    grow: 1,
                    minWidth: "0px",
                    class: "t-neutral-modfilter-preview-title",
                    children: [
                      { element: "workshopMod.name", class: "t-neutral-modfilter-preview-name" },
                      { element: "workshopMod.subscribed", class: "t-neutral-modfilter-preview-star" },
                    ],
                  },
                  { element: "workshopMod.viewOnSteam", class: "t-neutral-modfilter-preview-steam" },
                ],
              },
              {
                type: "stack",
                direction: "row",
                align: "center",
                wrap: true,
                class: "t-neutral-modfilter-preview-meta",
                children: [
                  { element: "workshopMod.score", class: "t-neutral-modfilter-preview-score" },
                  { element: "workshopMod.subscribers", class: "t-neutral-modfilter-preview-subs" },
                  { element: "workshopMod.size", class: "t-neutral-modfilter-preview-size" },
                  { element: "workshopMod.updated" },
                ],
              },
              {
                element: "workshopMod.description",
                class: "t-neutral-modfilter-preview-desc"
              },
              { element: "workshopMod.tags", class: "t-neutral-modfilter-preview-tags" },
              { element: "workshopMod.serverNote", class: "t-neutral-modfilter-preview-note" },
              {
                type: "stack",
                direction: "row",
                class: "t-neutral-modfilter-preview-picks",
                children: [
                  { element: "workshopMod.include", class: "t-neutral-modfilter-preview-include" },
                  { element: "workshopMod.exclude", class: "t-neutral-modfilter-preview-exclude" },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "stack",
        direction: "row",
        align: "center",
        class: "t-neutral-modfilter-footer",
        children: [
          {
            type: "stack",
            direction: "row",
            align: "center",
            class: "t-neutral-modfilter-selection",
            children: [
              { element: "modFilter.summary", class: "t-neutral-modfilter-summary" },
              { element: "modFilter.clear", class: "t-neutral-modfilter-clear" },
            ],
          },
          { element: "modFilter.matchMode", class: "t-neutral-modfilter-match" },
          { element: "modFilter.cancel", class: "t-neutral-modfilter-cancel" },
          { element: "modFilter.apply", class: "t-neutral-modfilter-apply" },
        ],
      },
    ],
  },
};
