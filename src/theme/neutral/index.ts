import type { LayoutFile } from "../renderer/types";
import { SHELL_LAYOUT } from "./shell";
import { BROWSER_LAYOUT } from "./browser";
import { MODS_LAYOUT } from "./mods";
import { SETTINGS_LAYOUT } from "./settings";
import { SERVER_INFO_MODAL } from "./server-info";
import { UPDATE_MODAL } from "./update";
import { MOD_FILTER_MODAL } from "./mod-filter";
import { SERVERS_LIST } from "./servers-list";
import { MODS_LIST, MOD_SERVERS_LIST } from "./mods-list";
import { SERVER_MODS_LIST } from "./server-mods-list";
import { MOD_FILTER_RESULTS_LIST } from "./mod-filter-results";
import { SERVER_ACTIONS_POPUP } from "./server-actions";

export {
  SHELL_LAYOUT,
  BROWSER_LAYOUT,
  MODS_LAYOUT,
  SETTINGS_LAYOUT,
  SERVER_INFO_MODAL,
  UPDATE_MODAL,
  MOD_FILTER_MODAL,
  SERVERS_LIST,
  MODS_LIST,
  MOD_SERVERS_LIST,
  SERVER_MODS_LIST,
  MOD_FILTER_RESULTS_LIST,
  SERVER_ACTIONS_POPUP,
};

/** Paths the theme engine draws from Neutral's own file instead of the launcher's legacy component. */
export const NEUTRAL_ENGINE_FILES: ReadonlySet<string> = new Set<string>(["layout/views/browser.json", "layout/shell.json", "layout/settings.json", "layout/modals/update.json", "layout/modals/modFilter.json", "layout/views/mods.json", "layout/modals/serverInfo.json"]);

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
  "layout/lists/modServers.json": MOD_SERVERS_LIST,
  "layout/lists/serverMods.json": SERVER_MODS_LIST,
  "layout/popups/serverActions.json": SERVER_ACTIONS_POPUP,
};

export function getNeutralLayout(file: string): LayoutFile | undefined {
  return NEUTRAL_LAYOUTS[file] ?? (file.startsWith("layout/") ? undefined : NEUTRAL_LAYOUTS[`layout/${file}`]);
}
