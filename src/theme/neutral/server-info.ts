import type { ElementNode, LayoutNode, ModalLayoutFile } from "../renderer/types";

const stat = (value: ElementNode & { class: string }, label: string, suffix?: Omit<ElementNode, "class">): LayoutNode => {
  const caption: LayoutNode = { type: "text", role: "micro", value: label, class: "t-neutral-serverinfo-stat-label" };
  return {
    type: "stack",
    direction: "column",
    class: "t-neutral-serverinfo-stat",
    children: [
      { ...value, class: `t-neutral-serverinfo-stat-value ${value.class}` },
      suffix
        ? {
            type: "stack",
            direction: "row",
            align: "baseline",
            justify: "center",
            children: [caption, { ...suffix, class: "t-neutral-serverinfo-stat-suffix" }],
          }
        : caption,
    ],
  };
};

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
              { element: "server.name", class: "t-neutral-serverinfo-name", options: { heading: true } },
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
                  stat(
                    { element: "server.gameTime", options: { showMultiplier: false }, class: "t-neutral-serverinfo-time" },
                    "Time",
                    { element: "server.gameTime", options: { showIcon: false } },
                  ),
                ],
              },
              { element: "server.readiness", class: "t-neutral-serverinfo-readiness", options: { basis: "declared" } },
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
              {
                type: "stack",
                direction: "column",
                class: "t-neutral-serverinfo-mods-section",
                children: [
                  {
                    type: "stack",
                    direction: "row",
                    class: "t-neutral-serverinfo-tools",
                    children: [
                      { element: "server.checkMods", class: "t-neutral-serverinfo-tool", options: { display: "iconLabel" } },
                      { element: "server.subscribeAll", class: "t-neutral-serverinfo-tool", options: { display: "iconLabel" } },
                      {
                        element: "server.unsubscribeUnique",
                        class: "t-neutral-serverinfo-tool t-neutral-serverinfo-tool-danger",
                        options: { display: "iconLabel", label: "Unsubscribe unique" },
                      },
                      { element: "server.copyAddress", class: "t-neutral-serverinfo-tool", options: { display: "iconLabel" } },
                    ],
                  },
                  { element: "server.downloadSize", class: "t-neutral-serverinfo-download" },
                  { element: "list.serverMods", class: "t-neutral-serverinfo-mods", options: { header: false } },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "stack",
        direction: "column",
        class: "t-neutral-serverinfo-actions",
        children: [
          { element: "server.actionNotice", class: "t-neutral-serverinfo-notice" },
          {
            type: "stack",
            direction: "row",
            class: "t-neutral-serverinfo-join-row",
            children: [
              { element: "server.join", class: "t-neutral-serverinfo-join", options: { wording: "fixAndJoin" } },
              { element: "server.cancel", class: "t-neutral-serverinfo-cancel" },
              {
                element: "server.menu",
                class: "t-neutral-serverinfo-menu",
                options: {
                  menu: "serverLoad",
                  icon: "chevronDown",
                  label: "Load this server's mods to the main menu",
                },
              },
            ],
          },
        ],
      },
    ],
  },
};
