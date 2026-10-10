import type { ModalLayoutFile } from "../renderer/types";
import "./mod-filter.css";

export const MOD_FILTER_MODAL: ModalLayoutFile = {
  schemaVersion: 2,
  placement: { mode: "center" },
  backdrop: "dim",
  root: {
    type: "stack",
    direction: "column",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        justify: "spaceBetween",
        children: [
          { type: "text", role: "heading", value: "Filter by Mod" },
          { element: "modal.close" },
        ],
      },
      { element: "list.modFilterResults" },
      { element: "modFilter.apply" },
    ],
  },
};
