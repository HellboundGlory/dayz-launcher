import type { LayoutNode, PopupLayoutFile } from "../renderer/types";

const SEPARATOR: LayoutNode = {
  type: "stack",
  direction: "row",
  class: "my-1 h-px w-full bg-line",
  children: [],
};

export const SERVER_ROW_POPUP: PopupLayoutFile = {
  schemaVersion: 2,
  placement: { mode: "anchored", side: "bottom", align: "start", offset: "0px" },
  root: {
    type: "stack",
    direction: "column",
    class:
      "t-neutral-serverrow-panel w-[236px] border border-line bg-surface p-[5px] [border-radius:var(--t-radius-popup)] [box-shadow:var(--t-shadow-popup)]",
    children: [
      {
        element: "server.join",
        class: "t-neutral-servers-menu-item",
        options: { display: "iconLabel" },
      },
      {
        element: "server.subscribeAll",
        class: "t-neutral-servers-menu-item",
        options: { display: "iconLabel", label: "Download mods only" },
      },
      {
        element: "server.favourite",
        class: "t-neutral-servers-menu-item",
        options: { display: "iconLabel", label: "Add to favourites", labelOn: "Remove from favourites" },
      },
      SEPARATOR,
      {
        element: "server.copyAddress",
        class: "t-neutral-servers-menu-item",
        options: { display: "iconLabel", label: "Copy address" },
      },
      { element: "server.copyJoinLink", class: "t-neutral-servers-menu-item", options: { display: "iconLabel" } },
      { element: "server.forgetPassword", class: "t-neutral-servers-menu-item", options: { display: "iconLabel" } },
      SEPARATOR,
      {
        element: "server.info",
        class: "t-neutral-servers-menu-item",
        options: { display: "iconLabel", label: "More info" },
      },
      { element: "server.actionNotice", class: "t-neutral-servers-notice" },
    ],
  },
};
