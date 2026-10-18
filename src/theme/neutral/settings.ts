import type { LayoutNode, SettingsLayoutFile } from "../renderer/types";

const sectionHeader = (section: string): LayoutNode => ({
  type: "stack",
  tag: "span",
  direction: "row",
  align: "center",
  class: "t-neutral-settings-section-head",
  children: [
    { element: "settings.sectionIcon", options: { section }, class: "t-neutral-settings-section-icon" },
    {
      type: "stack",
      tag: "span",
      direction: "column",
      class: "t-neutral-settings-section-text",
      children: [
        { element: "settings.sectionTitle", options: { section }, class: "t-neutral-settings-section-title" },
        { element: "settings.sectionDescription", options: { section }, class: "t-neutral-settings-section-desc" },
      ],
    },
    { type: "image", icon: "chevronDown", class: "t-neutral-settings-chevron" },
  ],
});

const groupTitle = (group: string): LayoutNode => ({
  element: "settings.groupTitle",
  options: { group },
  class: "t-neutral-settings-group-title",
});

// Boxes, not stacks: legacy groups are blocks whose margins collapse into each other.
const group = (children: LayoutNode[]): LayoutNode => ({
  type: "box",
  class: "t-neutral-settings-group",
  children,
});

export const SETTINGS_LAYOUT: SettingsLayoutFile = {
  schemaVersion: 2,
  presentation: {
    mode: "overlay",
    region: "r-main",
  },
  root: {
    type: "stack",
    direction: "column",
    class: "t-neutral-settings-root",
    children: [
      {
        type: "stack",
        direction: "row",
        class: "t-neutral-settings-head",
        children: [
          {
            type: "stack",
            direction: "row",
            class: "t-neutral-settings-head-group",
            children: [
              { element: "settings.back", options: { display: "iconLabel" } },
              { element: "settings.title" },
            ],
          },
        ],
      },
      {
        type: "scroll",
        class: "t-neutral-settings-body",
        children: [
          {
            type: "accordion",
            id: "r-settings",
            class: "t-neutral-settings-sections",
            mode: "single",
            initial: "none",
            sections: [
              {
                id: "game",
                header: sectionHeader("game"),
                body: {
                  type: "stack",
                  direction: "column",
                  children: [
                    { element: "settings.profileName" },
                    {
                      type: "stack",
                      direction: "row",
                      align: "end",
                      class: "t-neutral-settings-field-row",
                      children: [
                        { element: "settings.dayzPath", class: "t-neutral-settings-field", grow: 1 },
                        { element: "settings.detectPaths" },
                      ],
                    },
                    { element: "settings.workshopPath" },
                    { element: "settings.launchParams" },
                  ],
                },
              },
              {
                id: "launcher",
                header: sectionHeader("launcher"),
                body: {
                  type: "box",
                  children: [
                    groupTitle("window"),
                    { element: "settings.minimiseToTray" },
                    { element: "settings.closeToTray" },
                    group([{ element: "settings.onJoin" }]),
                    group([
                      groupTitle("startup"),
                      { element: "settings.startWithWindows" },
                      {
                        element: "settings.startMinimised",
                        class: "t-neutral-settings-start-minimised",
                      },
                    ]),
                    group([groupTitle("discord"), { element: "settings.discordPresence" }]),
                    group([
                      {
                        type: "stack",
                        direction: "row",
                        align: "end",
                        class: "t-neutral-settings-field-row",
                        children: [
                          { element: "settings.dataFolder", class: "t-neutral-settings-field", grow: 1 },
                          { element: "settings.openDataFolder" },
                        ],
                      },
                    ]),
                    group([{ element: "settings.autoRefresh" }]),
                  ],
                },
              },
              {
                id: "theme",
                header: sectionHeader("theme"),
                body: {
                  type: "stack",
                  direction: "column",
                  children: [{ element: "settings.themeManagement" }],
                },
              },
            ],
          },
        ],
      },
    ],
  },
};
