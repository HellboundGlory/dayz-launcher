import type { ElementNode, LayoutNode, ModalLayoutFile } from "../renderer/types";
import "./server-info.css";

const stat = (value: ElementNode & { class: string }, label: string): LayoutNode => ({
  type: "stack",
  direction: "column",
  class: "t-neutral-serverinfo-stat",
  children: [
    { ...value, class: `t-neutral-serverinfo-stat-value ${value.class}` },
    { type: "text", role: "micro", value: label, class: "t-neutral-serverinfo-stat-label" },
  ],
});

const prop = (label: string, value: ElementNode): LayoutNode => ({
  type: "stack",
  direction: "row",
  class: "t-neutral-serverinfo-prop",
  children: [
    { type: "text", role: "caption", value: label, class: "t-neutral-serverinfo-prop-label" },
    { ...value, class: "t-neutral-serverinfo-prop-value" },
  ],
});

export const SERVER_INFO_MODAL: ModalLayoutFile = {
  schemaVersion: 2,
  placement: { mode: "center" },
  backdrop: "dim",
  root: {
    type: "stack",
    direction: "column",
    class: "t-neutral-serverinfo",
    children: [
      {
        type: "stack",
        direction: "column",
        class: "t-neutral-serverinfo-body",
        children: [
          {
            element: "modal.close",
            class: "t-neutral-serverinfo-close",
            position: { anchor: "topRight", x: "12px", y: "10px" },
          },
          {
            type: "box",
            class: "t-neutral-serverinfo-identity",
            children: [
              { element: "server.name", class: "t-neutral-serverinfo-name" },
              {
                element: "server.address",
                class: "t-neutral-serverinfo-address",
                options: { showGamePort: true },
              },
              {
                element: "server.tags",
                class: "t-neutral-serverinfo-tags",
                options: { officialWording: "official", showBattleye: true, showModUpdate: false },
              },
            ],
          },
          {
            type: "scroll",
            class: "t-neutral-serverinfo-scroll",
            children: [
              {
                type: "grid",
                class: "t-neutral-serverinfo-stats",
                children: [
                  stat({ element: "server.players", options: { showCaption: false, showQueue: false }, class: "t-neutral-serverinfo-players" }, "Players"),
                  stat({ element: "server.ping", options: { showCaption: false }, class: "t-neutral-serverinfo-ping" }, "Ping ms"),
                  stat({ element: "server.gameTime", class: "t-neutral-serverinfo-time" }, "Time"),
                ],
              },
              {
                type: "stack",
                direction: "column",
                class: "t-neutral-serverinfo-props",
                children: [
                  prop("Map", { element: "server.map" }),
                  prop("Version", { element: "server.version" }),
                  prop("Region", { element: "server.region" }),
                  prop("Mods", { element: "server.modCount", options: { showCaption: false } }),
                ],
              },
            ],
          },
        ],
      },
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
