import type { PopupLayoutFile } from "../renderer/types";
import "./server-actions.css";

export const SERVER_ACTIONS_POPUP: PopupLayoutFile = {
  schemaVersion: 2,
  placement: { mode: "anchored", side: "bottom", align: "end" },
  root: {
    type: "stack",
    direction: "column",
    children: [
      { element: "server.info", options: { display: "iconLabel", label: "More info" } },
      { element: "server.loadToMenu", options: { display: "iconLabel", icon: "listTree" } },
      { element: "server.subscribeAll", options: { display: "iconLabel" } },
      { element: "server.checkMods", options: { display: "iconLabel", icon: "refresh" } },
      { element: "server.unsubscribeUnique", options: { display: "iconLabel", label: "Unsubscribe unique mods" } },
      { element: "server.copyAddress", options: { display: "iconLabel" } },
      { element: "server.actionNotice" },
    ],
  },
};
