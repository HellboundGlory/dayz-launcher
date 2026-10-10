import type { SettingsLayoutFile } from "../renderer/types";
import "./settings.css";

export const SETTINGS_LAYOUT: SettingsLayoutFile = {
  schemaVersion: 2,
  presentation: {
    mode: "overlay",
    region: "r-main",
  },
  root: {
    type: "stack",
    direction: "column",
    children: [
      { element: "settings.back" },
      {
        type: "accordion",
        id: "r-settings",
        mode: "single",
        initial: "none",
        sections: [
          {
            id: "game",
            header: { type: "text", role: "heading", value: "Game" },
            body: {
              type: "stack",
              direction: "column",
              children: [
                { element: "settings.profileName" },
                { element: "settings.dayzPath" },
                { element: "settings.detectPaths" },
                { element: "settings.workshopPath" },
                { element: "settings.launchParams" },
                { element: "settings.onJoin" },
              ],
            },
          },
          {
            id: "launcher",
            header: { type: "text", role: "heading", value: "Launcher" },
            body: {
              type: "stack",
              direction: "column",
              children: [
                { element: "settings.minimiseToTray" },
                { element: "settings.closeToTray" },
                { element: "settings.startWithWindows" },
                { element: "settings.startMinimised" },
                { element: "settings.discordPresence" },
                { element: "settings.dataFolder" },
                { element: "settings.openDataFolder" },
                { element: "settings.autoRefresh" },
              ],
            },
          },
          {
            id: "theme",
            header: { type: "text", role: "heading", value: "Theme" },
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
};
