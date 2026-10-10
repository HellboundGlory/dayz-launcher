import type { ModalLayoutFile } from "../renderer/types";
import "./update.css";

export const UPDATE_MODAL: ModalLayoutFile = {
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
          { type: "text", role: "heading", value: "Update Available" },
          { element: "modal.close" },
        ],
      },
      { element: "update.viewRelease" },
      { element: "update.install" },
    ],
  },
};
