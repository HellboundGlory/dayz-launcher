import type { LayoutFile } from "../renderer/types";
import "./mod-filter-results.css";

export const MOD_FILTER_RESULTS_LIST: LayoutFile = {
  schemaVersion: 2,
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    children: [{ element: "workshopMod.pick" }],
  },
};
