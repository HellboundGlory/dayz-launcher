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
            children: [],
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
