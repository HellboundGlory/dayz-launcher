import type { ModalLayoutFile } from "../renderer/types";
import "./update.css";

export const UPDATE_MODAL: ModalLayoutFile = {
  schemaVersion: 2,
  placement: { mode: "center" },
  backdrop: "dim",
  root: {
    type: "stack",
    direction: "column",
    class: "t-neutral-update",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        justify: "spaceBetween",
        class: "t-neutral-update-header",
        children: [
          { element: "update.title", class: "t-neutral-update-title" },
          { element: "modal.close", class: "t-neutral-update-close" },
        ],
      },
      {
        type: "scroll",
        class: "t-neutral-update-body",
        children: [
          { element: "update.summary", class: "t-neutral-update-summary" },
          { element: "update.changelog", class: "t-neutral-update-changelog" },
          { element: "update.progress", class: "t-neutral-update-progress" },
          { element: "update.portableNote", class: "t-neutral-update-portable" },
        ],
      },
      {
        type: "stack",
        direction: "row",
        align: "center",
        justify: "end",
        class: "t-neutral-update-footer",
        children: [
          { element: "update.later", class: "t-neutral-update-later" },
          { element: "update.install", class: "t-neutral-update-install" },
          { element: "update.viewRelease", class: "t-neutral-update-view-release" },
        ],
      },
    ],
  },
};
