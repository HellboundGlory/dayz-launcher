import type { LayoutFile, ModalLayoutFile, SettingsLayoutFile } from "../renderer/types";

export const SHELL_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    height: "100%",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        landmark: "banner",
        children: [
          { element: "app.logo" },
          { surface: "surface.navRail" },
          { element: "app.dragRegion", grow: 1 },
          { surface: "surface.windowControls" },
        ],
      },
      { element: "notice.storage" },
      { element: "notice.error" },
      {
        type: "box",
        id: "r-main",
        landmark: "main",
        grow: 1,
        children: [{ type: "outlet", name: "view" }],
      },
      {
        type: "stack",
        direction: "row",
        align: "center",
        landmark: "contentinfo",
        children: [
          { element: "status.steam" },
          { element: "status.serverTotal" },
          { element: "status.populated" },
          { element: "status.lastRefreshed" },
          { element: "status.listSource" },
        ],
      },
      { type: "outlet", name: "modals" },
    ],
  },
};

export const BROWSER_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    height: "100%",
    grow: 1,
    children: [
      { surface: "surface.filterBar" },
      {
        type: "stack",
        direction: "row",
        grow: 1,
        children: [
          { element: "list.servers", grow: 1 },
          {
            type: "stack",
            id: "r-detail",
            context: "selection",
            direction: "column",
            children: [
              { element: "server.name" },
              { element: "server.address" },
              { element: "server.players" },
              { element: "server.ping" },
              { element: "server.map" },
              { element: "server.gameTime" },
              { element: "server.tags" },
              { element: "list.serverMods" },
              { element: "server.join" },
              { element: "server.actionNotice" },
            ],
          },
        ],
      },
    ],
  },
};

export const MODS_LAYOUT: LayoutFile = {
  schemaVersion: 2,
  root: {
    type: "stack",
    direction: "column",
    height: "100%",
    grow: 1,
    children: [
      { element: "notice.modsError" },
      { element: "notice.modsCached" },
      { element: "notice.modsResult" },
      {
        type: "stack",
        direction: "row",
        grow: 1,
        children: [
          { element: "list.mods", grow: 1 },
          {
            type: "stack",
            context: "modSelection",
            direction: "column",
            children: [
              { element: "mod.name" },
              { element: "mod.status" },
              { element: "mod.size" },
              { element: "mod.updated" },
              { element: "mod.subscribed" },
              { element: "mod.update" },
              { element: "mod.openInSteam" },
              { element: "mod.openFolder" },
              { element: "mod.reinstall" },
            ],
          },
        ],
      },
    ],
  },
};

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
      { element: "server.players" },
      { element: "server.ping" },
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

export const MOD_FILTER_MODAL: ModalLayoutFile = {
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
          { type: "text", role: "heading", value: "Filter by Mod" },
          { element: "modal.close" },
        ],
      },
      { element: "list.modFilterResults" },
      { element: "modFilter.apply" },
    ],
  },
};

export const SERVERS_LIST: LayoutFile = {
  schemaVersion: 2,
  columns: [
    { id: "favourite", width: "40px" },
    { id: "name", width: "1fr", label: "Server Name", sort: "name" },
    { id: "players", width: "90px", label: "Players", sort: "players" },
    { id: "map", width: "120px", label: "Map", sort: "map" },
    { id: "ping", width: "70px", label: "Ping", sort: "ping" },
    { id: "actions", width: "140px", label: "Actions" },
  ],
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    children: [
      { element: "server.favourite", column: "favourite" },
      {
        type: "stack",
        direction: "column",
        column: "name",
        children: [
          { element: "server.name" },
          { element: "server.tags" },
        ],
      },
      { element: "server.players", column: "players" },
      { element: "server.map", column: "map" },
      { element: "server.ping", column: "ping" },
      {
        type: "stack",
        direction: "row",
        column: "actions",
        children: [
          { element: "server.join" },
          { element: "server.actionNotice" },
        ],
      },
    ],
  },
};

export const MODS_LIST: LayoutFile = {
  schemaVersion: 2,
  columns: [
    { id: "name", width: "1fr", label: "Name", sort: "name" },
    { id: "status", width: "120px", label: "Status", sort: "status" },
    { id: "size", width: "100px", label: "Size", sort: "size" },
    { id: "updated", width: "140px", label: "Updated", sort: "updated" },
  ],
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    children: [
      {
        type: "stack",
        direction: "row",
        align: "center",
        column: "name",
        children: [
          { element: "mod.select" },
          { element: "mod.name" },
        ],
      },
      { element: "mod.status", column: "status" },
      { element: "mod.size", column: "size" },
      {
        type: "stack",
        direction: "row",
        align: "center",
        column: "updated",
        children: [
          { element: "mod.updated" },
          { element: "mod.subscribed" },
        ],
      },
    ],
  },
};

export const MOD_FILTER_RESULTS_LIST: LayoutFile = {
  schemaVersion: 2,
  row: {
    type: "stack",
    direction: "row",
    align: "center",
    children: [{ element: "workshopMod.pick" }],
  },
};

export const NEUTRAL_LAYOUTS: Record<string, LayoutFile> = {
  "layout/shell.json": SHELL_LAYOUT,
  "layout/views/browser.json": BROWSER_LAYOUT,
  "layout/views/mods.json": MODS_LAYOUT,
  "layout/settings.json": SETTINGS_LAYOUT,
  "layout/modals/serverInfo.json": SERVER_INFO_MODAL,
  "layout/modals/update.json": UPDATE_MODAL,
  "layout/modals/modFilter.json": MOD_FILTER_MODAL,
  "layout/lists/servers.json": SERVERS_LIST,
  "layout/lists/mods.json": MODS_LIST,
  "layout/lists/modFilterResults.json": MOD_FILTER_RESULTS_LIST,
};

export function getNeutralLayout(file: string): LayoutFile | undefined {
  return NEUTRAL_LAYOUTS[file] ?? (file.startsWith("layout/") ? undefined : NEUTRAL_LAYOUTS[`layout/${file}`]);
}
