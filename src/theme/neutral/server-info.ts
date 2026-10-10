import type { ModalLayoutFile } from "../renderer/types";
import "./server-info.css";

export const SERVER_INFO_MODAL: ModalLayoutFile = {
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
          { element: "server.name" },
          { element: "modal.close" },
        ],
      },
      { element: "server.address" },
      { element: "server.players", options: { showCaption: false } },
      { element: "server.ping", options: { showCaption: false } },
      { element: "server.map" },
      { element: "server.gameTime" },
      { element: "server.tags" },
      { element: "list.serverMods" },
      {
        type: "stack",
        direction: "row",
        children: [
          { element: "server.join" },
          { element: "server.actionNotice" },
        ],
      },
    ],
  },
};
