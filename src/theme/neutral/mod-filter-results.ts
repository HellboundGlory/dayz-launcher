import type { LayoutFile } from "../renderer/types";

export const MOD_FILTER_RESULTS_LIST: LayoutFile = {
  schemaVersion: 2,
  estimatedRowHeight: "48px",
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    class: "t-neutral-modfilter-results-row",
    children: [
      { element: "workshopMod.thumbnail", class: "t-neutral-modfilter-results-thumb" },
      {
        type: "stack",
        direction: "row",
        align: "center",
        class: "t-neutral-modfilter-results-title",
        children: [
          { element: "workshopMod.name" },
          { element: "workshopMod.subscribed", class: "t-neutral-modfilter-results-star" },
        ],
      },
      { element: "workshopMod.serverCount", class: "t-neutral-modfilter-results-servers" },
      { element: "workshopMod.pick", class: "t-neutral-modfilter-results-pick" },
    ],
  },
};
