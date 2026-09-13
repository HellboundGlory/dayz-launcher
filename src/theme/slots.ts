// Slot registry for the theming system — the single source of truth for the
// `data-tetra-slot` (container) and `data-tetra-el` (child) attributes tagged
// onto the launcher's JSX. Nothing reads these attributes yet: Phase 0 is
// additive markup only, so tagging a slot has no runtime effect.
//
// `themeable: "full"` means a theme may restyle the slot wholesale;
// `"tokensOnly"` would restrict it to the CSS custom properties in
// `palette.ts`. Every slot in this phase is "full".

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
}

/** Every themable slot, in shell render order. */
export const SLOTS: Slot[] = [
  {
    id: "shell.sidebar",
    themeable: "full",
    children: [
      { id: "navList", required: true, since: "1.0" },
      { id: "settingsEntry", required: true, since: "1.0" },
      { id: "collapseToggle", required: false, since: "1.0" },
      { id: "logo", required: false, since: "1.0" },
    ],
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
    ],
  },
  {
    id: "filterBar",
    themeable: "full",
    children: [
      { id: "searchInput", required: true, since: "1.0" },
      { id: "refreshAction", required: true, since: "1.0" },
      { id: "mapFilter", required: false, since: "1.0" },
      { id: "tagsFilter", required: false, since: "1.0" },
      { id: "countryFilter", required: false, since: "1.0" },
      { id: "modsFilter", required: false, since: "1.0" },
      { id: "sortControl", required: false, since: "1.0" },
      { id: "pingSlider", required: false, since: "1.0" },
    ],
  },
  {
    id: "server.row",
    themeable: "full",
    children: [
      { id: "name", required: true, since: "1.0" },
      { id: "joinAction", required: true, since: "1.0" },
      { id: "modStatusBadge", required: true, since: "1.0" },
      { id: "pingBadge", required: false, since: "1.0" },
      { id: "playerCount", required: false, since: "1.0" },
      { id: "tagsLine", required: false, since: "1.0" },
      { id: "regionFlag", required: false, since: "1.0" },
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
      { id: "joinAction", required: true, since: "1.0" },
      { id: "statGrid", required: false, since: "1.0" },
      { id: "readinessStrip", required: false, since: "1.0" },
      { id: "propsList", required: false, since: "1.0" },
    ],
  },
  {
    id: "modal.modFilter",
    themeable: "full",
    children: [
      { id: "closeAction", required: true, since: "1.0" },
      { id: "applyAction", required: true, since: "1.0" },
      { id: "tabStrip", required: false, since: "1.0" },
      { id: "previewPane", required: false, since: "1.0" },
    ],
  },
  {
    id: "mods.toolbar",
    themeable: "full",
    children: [
      { id: "searchInput", required: true, since: "1.0" },
      { id: "refreshAction", required: true, since: "1.0" },
      { id: "statusFilter", required: false, since: "1.0" },
    ],
  },
  {
    id: "mods.row",
    themeable: "full",
    children: [
      { id: "modName", required: true, since: "1.0" },
      { id: "modStatusBadge", required: true, since: "1.0" },
      { id: "sizeLabel", required: false, since: "1.0" },
      { id: "usageCount", required: false, since: "1.0" },
    ],
  },
  {
    id: "mods.inspector",
    themeable: "full",
    children: [
      { id: "closeAction", required: true, since: "1.0" },
      { id: "detailFields", required: false, since: "1.0" },
    ],
  },
  {
    id: "modal.onboarding",
    themeable: "full",
    children: [
      { id: "primaryAction", required: true, since: "1.0" },
      { id: "pathBrowser", required: false, since: "1.0" },
    ],
  },
  {
    id: "settings.shell",
    themeable: "full",
    children: [
      { id: "backAction", required: true, since: "1.0" },
    ],
  },
  {
    id: "settings.game",
    themeable: "full",
    children: [
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
    children: [
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
    children: [
      { id: "themeManagement", required: true, since: "1.0" },
    ],
  },
];
