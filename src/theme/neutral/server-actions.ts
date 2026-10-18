import type { PopupLayoutFile } from "../renderer/types";

export const SERVER_ACTIONS_POPUP: PopupLayoutFile = {
  schemaVersion: 2,
  placement: { mode: "anchored", side: "bottom", align: "end" },
  root: {
    type: "stack",
    direction: "column",
    class: "t-neutral-servers-menu-panel",
    children: [
      { element: "server.info", class: "t-neutral-servers-menu-item", options: { display: "iconLabel", label: "More info" } },
      { element: "server.loadToMenu", class: "t-neutral-servers-menu-item", options: { display: "iconLabel", icon: "listTree" } },
      { element: "server.subscribeAll", class: "t-neutral-servers-menu-item", options: { display: "iconLabel" } },
      { element: "server.checkMods", class: "t-neutral-servers-menu-item", options: { display: "iconLabel", icon: "refresh" } },
      {
        element: "server.unsubscribeUnique",
        class: "t-neutral-servers-menu-item",
        options: { display: "iconLabel", label: "Unsubscribe unique mods" },
      },
      { element: "server.copyAddress", class: "t-neutral-servers-menu-item", options: { display: "iconLabel" } },
      { element: "server.actionNotice", class: "t-neutral-servers-notice" },
    ],
  },
};
