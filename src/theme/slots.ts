// Slot registry for the theming system — the single source of truth for the
// `data-tetra-slot` (container) and `data-tetra-el` (child) attributes tagged
// onto the launcher's JSX, and for what layout/composition a theme may do to
// each slot. Live runtime registry, consumed by layout-store.ts,
// component-tree.ts, and the Dev Mode inspector.
//
// `themeable: "full"` means a theme may restyle the slot wholesale;
// `"tokensOnly"` would restrict it to the CSS custom properties in
// `palette.ts`. Every slot in this registry is "full". `compositionCeiling`
// is a separate, narrower restriction — see its own doc comment below.

export interface SlotChild {
  /** Matches `data-tetra-el` on the element rendering this child. */
  id: string;
  /** A theme that omits a required child is invalid, not merely incomplete. */
  required: boolean;
  /** Registry version the child was introduced in. */
  since: string;
}

export interface Slot {
  /** Matches `data-tetra-slot` on the slot's container element. */
  id: string;
  children: SlotChild[];
  themeable: "full" | "tokensOnly";
  /**
   * Expert-tier composition ceiling (Phase 3.6, ADR-0001). Absent (default)
   * means a `components/<id>.json` composition file is legal for this slot,
   * same as ordinary layout theming. `"advanced"` caps it below Expert —
   * layout.json (visibility/order/size) still applies, but no composition
   * file, no free positioning, no decorative images — for slots where a
   * plausible-but-misleading layout causes real harm (recovery/config
   * surfaces) rather than just looking bad.
   */
  compositionCeiling?: "advanced";
}

/** Every themable slot, in shell render order. */
export const SLOTS: Slot[] = [
  {
    id: "shell.sidebar",
    themeable: "full",
    children: [
      { id: "logo", required: false, since: "1.0" },
      { id: "navList", required: true, since: "1.0" },
      { id: "navServers", required: true, since: "1.0" },
      { id: "navFavourites", required: false, since: "1.0" },
      { id: "navRecent", required: false, since: "1.0" },
      { id: "navMods", required: false, since: "1.0" },
      { id: "settingsEntry", required: true, since: "1.0" },
      { id: "collapseToggle", required: false, since: "1.0" },
    ],
  },
  {
    id: "view.servers",
    themeable: "full",
    // Pure backdrop, like settings.background — filterBar/server.row/etc.
    // are already independently addressable, not children of this one.
    children: [],
  },
  {
    id: "view.favourites",
    themeable: "full",
    children: [],
  },
  {
    id: "view.recent",
    themeable: "full",
    children: [],
  },
  {
    id: "view.mods",
    themeable: "full",
    children: [],
  },
  {
    id: "shell.header",
    themeable: "full",
    children: [
      { id: "windowControls", required: true, since: "1.0" },
      { id: "dragRegion", required: false, since: "1.0" },
    ],
  },
  {
    id: "shell.footer",
    themeable: "full",
    children: [
      { id: "steamStateChip", required: true, since: "1.0" },
      { id: "serverCounts", required: false, since: "1.0" },
      { id: "uiScaleSlider", required: false, since: "1.0" },
      { id: "schemeToggle", required: false, since: "1.0" },
    ],
  },
  {
    id: "filterBar",
    themeable: "full",
    children: [
      { id: "searchInput", required: true, since: "1.0" },
      { id: "mapFilter", required: false, since: "1.0" },
      { id: "tagsFilter", required: false, since: "1.0" },
      { id: "modsFilter", required: false, since: "1.0" },
      { id: "countryFilter", required: false, since: "1.0" },
      { id: "sortControl", required: false, since: "1.0" },
      { id: "pingSlider", required: false, since: "1.0" },
      { id: "hideEmptyToggle", required: false, since: "1.1" },
      { id: "hideFullToggle", required: false, since: "1.1" },
      { id: "hideLockedToggle", required: false, since: "1.1" },
      { id: "hideOfflineToggle", required: false, since: "1.1" },
      { id: "resetAction", required: false, since: "1.1" },
      { id: "refreshAction", required: true, since: "1.0" },
    ],
  },
  {
    id: "server.row",
    themeable: "full",
    children: [
      { id: "favouriteAction", required: false, since: "1.0" },
      { id: "tagsLine", required: false, since: "1.0" },
      { id: "modStatusBadge", required: true, since: "1.0" },
      { id: "name", required: true, since: "1.0" },
      { id: "mapLabel", required: false, since: "1.0" },
      { id: "gameTimeLabel", required: false, since: "1.0" },
      { id: "regionFlag", required: false, since: "1.0" },
      { id: "addressLabel", required: false, since: "1.0" },
      { id: "lastPlayedLabel", required: false, since: "1.0" },
      { id: "playerCount", required: false, since: "1.0" },
      { id: "pingBadge", required: false, since: "1.0" },
      { id: "modCountLabel", required: false, since: "1.0" },
    ],
  },
  {
    id: "server.rowActions",
    themeable: "full",
    children: [
      { id: "joinAction", required: true, since: "1.0" },
      { id: "moreInfoItem", required: false, since: "1.0" },
      { id: "loadToMenuItem", required: false, since: "1.0" },
      { id: "downloadModsItem", required: false, since: "1.0" },
    ],
  },
  {
    id: "modal.serverInfo",
    themeable: "full",
    children: [
      { id: "closeAction", required: true, since: "1.0" },
      { id: "statGrid", required: false, since: "1.0" },
      { id: "readinessStrip", required: false, since: "1.0" },
      { id: "propsList", required: false, since: "1.0" },
      { id: "joinAction", required: true, since: "1.0" },
    ],
  },
  {
    id: "modal.modFilter",
    themeable: "full",
    children: [
      { id: "closeAction", required: true, since: "1.0" },
      { id: "tabStrip", required: false, since: "1.0" },
      { id: "previewPane", required: false, since: "1.0" },
      { id: "applyAction", required: true, since: "1.0" },
    ],
  },
  {
    id: "modal.update",
    themeable: "full",
    children: [
      { id: "closeAction", required: true, since: "1.0" },
      { id: "laterAction", required: true, since: "1.0" },
      { id: "installAction", required: false, since: "1.0" },
      { id: "viewReleaseAction", required: false, since: "1.0" },
    ],
  },
  {
    id: "modal.steamRequired",
    themeable: "full",
    // Restricted (Phase 3.6, ADR-0001): a blocking recovery surface — capped
    // at Advanced tier.
    compositionCeiling: "advanced",
    children: [
      { id: "errorCopy", required: false, since: "1.0" },
      { id: "startSteamAction", required: false, since: "1.0" },
      { id: "retryAction", required: false, since: "1.0" },
    ],
  },
  {
    id: "mods.toolbar",
    themeable: "full",
    children: [
      { id: "searchInput", required: true, since: "1.0" },
      { id: "statusFilter", required: false, since: "1.0" },
      { id: "refreshAction", required: true, since: "1.0" },
    ],
  },
  {
    id: "mods.row",
    themeable: "full",
    children: [
      { id: "selectCheckbox", required: true, since: "1.0" },
      { id: "modIcon", required: false, since: "1.0" },
      { id: "modName", required: true, since: "1.0" },
      { id: "modTags", required: false, since: "1.0" },
      { id: "modStatusBadge", required: true, since: "1.0" },
      { id: "sizeLabel", required: false, since: "1.0" },
      { id: "updatedLabel", required: false, since: "1.0" },
    ],
  },
  {
    id: "mods.inspector",
    themeable: "full",
    children: [
      { id: "closeAction", required: true, since: "1.0" },
      { id: "previewImage", required: false, since: "1.0" },
      { id: "name", required: true, since: "1.0" },
      { id: "status", required: true, since: "1.0" },
      { id: "tags", required: false, since: "1.0" },
      { id: "description", required: false, since: "1.0" },
      { id: "detailFields", required: false, since: "1.0" },
      { id: "updateAction", required: false, since: "1.0" },
      { id: "openInSteamAction", required: false, since: "1.0" },
      { id: "openFolderAction", required: false, since: "1.0" },
      { id: "reinstallAction", required: false, since: "1.0" },
    ],
  },
  {
    id: "mods.actionBar",
    themeable: "full",
    children: [
      { id: "totalCount", required: false, since: "1.0" },
      { id: "selectAllAction", required: false, since: "1.0" },
      { id: "clearSelectionAction", required: false, since: "1.0" },
      { id: "uniqueToServerAction", required: false, since: "1.0" },
      { id: "cleanupRemovedAction", required: false, since: "1.0" },
      { id: "unsubscribeAction", required: false, since: "1.0" },
      { id: "updateOutdatedAction", required: false, since: "1.0" },
      { id: "verifyAction", required: false, since: "1.0" },
    ],
  },
  {
    id: "modal.onboarding",
    themeable: "full",
    // Restricted (Phase 3.6, ADR-0001): first-run path setup is a recovery
    // surface, not an ordinary content view — capped at Advanced tier.
    compositionCeiling: "advanced",
    children: [
      { id: "pathBrowser", required: false, since: "1.0" },
      { id: "primaryAction", required: true, since: "1.0" },
    ],
  },
  {
    id: "settings.background",
    themeable: "full",
    compositionCeiling: "advanced",
    // Pure backdrop: nothing here is individually addressable, only
    // restylable as a whole (`[data-tetra-slot="settings.background"] {...}`).
    children: [],
  },
  {
    id: "settings.shell",
    themeable: "full",
    compositionCeiling: "advanced",
    children: [
      { id: "backAction", required: true, since: "1.0" },
    ],
  },
  {
    id: "settings.game",
    themeable: "full",
    compositionCeiling: "advanced",
    children: [
      { id: "sectionToggle", required: true, since: "1.0" },
      { id: "profileNameInput", required: true, since: "1.0" },
      { id: "dayzPathInput", required: true, since: "1.0" },
      { id: "detectPathsAction", required: false, since: "1.0" },
      { id: "workshopPathInput", required: false, since: "1.0" },
      { id: "launchParamsInput", required: false, since: "1.0" },
    ],
  },
  {
    id: "settings.launcher",
    themeable: "full",
    compositionCeiling: "advanced",
    children: [
      { id: "sectionToggle", required: true, since: "1.0" },
      { id: "windowOptions", required: false, since: "1.0" },
      { id: "onJoinBehavior", required: false, since: "1.0" },
      { id: "startupOptions", required: false, since: "1.0" },
      { id: "discordOption", required: false, since: "1.0" },
      { id: "dataFolderControl", required: false, since: "1.0" },
      { id: "autoRefreshControl", required: false, since: "1.0" },
    ],
  },
  {
    id: "settings.theme",
    themeable: "full",
    compositionCeiling: "advanced",
    children: [
      { id: "sectionToggle", required: true, since: "1.0" },
      { id: "themeManagement", required: true, since: "1.0" },
    ],
  },
];

