import { invoke } from "@tauri-apps/api/core";
import type { Server } from "@/types/server";

// ── Server Commands ──

export interface FilterParams {
  maps: string[];
  countries: string[];
  hide_empty: boolean;
  hide_full: boolean;
  hide_locked: boolean;
  hide_offline: boolean;
  max_ping: number | null;
  search: string | null;
  favourites_only: boolean;
  recent_only: boolean;
  official: boolean | null;
  modded: boolean | null;
  first_person: boolean | null;
  hide_placeholder: boolean;
  english_names: boolean | null;
}

export interface SortParams {
  sort_key: string;
  sort_dir: string;
  limit: number;
}

export async function getServerList(
  filter: FilterParams,
  sort: SortParams,
): Promise<Server[]> {
  return invoke<Server[]>("get_server_list", {
    filterParams: filter,
    sortParams: sort,
  });
}

export async function discoverServers(): Promise<void> {
  return invoke<void>("discover_servers");
}

/**
 * Look up a single server by address, regardless of whatever filter/sort the
 * table currently has loaded. Backs the `dzsa://` deep-link flow, where the
 * named server may not be among the frontend's currently-loaded rows at all.
 */
export async function getServer(addr: string, queryPort: number): Promise<Server | null> {
  return invoke<Server | null>("get_server", { addr, queryPort });
}

export async function toggleFavourite(
  addr: string,
  queryPort: number,
  favourite: boolean,
): Promise<void> {
  return invoke<void>("toggle_favourite", { addr, queryPort, favourite });
}

/**
 * Bulk A2S refresh over the backend's own refresh-priority window, independent
 * of what is on screen.
 *
 * Currently has no caller. The only one was a manual re-discover path in
 * `App.tsx` that was never reachable — its button was never rendered — and the
 * REFRESH button uses {@link refreshVisibleServers} instead. Kept because the
 * backend command is live and this is the shape the planned periodic
 * auto-refresh needs; a miss here deliberately does *not* mark a server
 * offline, which is what makes it safe to run unattended.
 */
export async function refreshServers(filter?: FilterParams): Promise<void> {
  return invoke<void>("refresh_servers", {
    filterParams: filter ?? null,
  });
}

export interface AddrPort {
  addr: string;
  query_port: number;
}

/** Who asked for a refresh, echoed back on `refresh-complete`. */
export type RefreshScope = "visible" | "row";

/**
 * A2S-refresh exactly the given servers, rather than a broad backend-picked
 * window — pass whatever is actually on screen. A miss here is written back
 * as `online: false`, unlike {@link refreshServers}.
 *
 * `scope` matters because a single-row refresh and a full one raise the same
 * completion event: without it, refreshing one row mid-refresh cleared the
 * main spinner and stamped a "refreshed at" the full pass had not reached.
 */
export async function refreshVisibleServers(
  addrs: AddrPort[],
  scope: RefreshScope = "visible",
): Promise<void> {
  return invoke<void>("refresh_visible_servers", { addrs, scope });
}

export interface ModsPendingEntry {
  addr: string;
  query_port: number;
  pending: boolean;
}

export async function getMapList(): Promise<[string, string][]> {
  return invoke<[string, string][]>("get_map_list");
}

export interface ServerCounts {
  total: number;
  populated: number;
}

export async function getServerCounts(): Promise<ServerCounts> {
  return invoke<ServerCounts>("get_server_counts");
}

/**
 * Whether the registry fell back to in-memory storage at startup.
 *
 * `true` means browsing and launching work, but favourites and recently-played
 * are lost on exit. Worth telling the user up front rather than letting them
 * discover it when their favourites vanish.
 */
export async function registryDegraded(): Promise<boolean> {
  return invoke<boolean>("registry_degraded");
}

// ── Steam Commands ──

/** Mirrors the Rust `InitFailure`. */
export type SteamInitFailure =
  /** No Steam client answered — the user has not started Steam. */
  | "steam_not_running"
  /** Steam answered but is older than the version DayZ needs. */
  | "steam_out_of_date"
  /**
   * Steam answered but wouldn't start a DayZ session. Reported identically for
   * a client that is still signing in and for an account with no DayZ licence.
   */
  | "steam_not_ready"
  /** Our own Steam thread failed. Nothing the user can act on. */
  | "internal"
  /**
   * The backend connection was lost after a successful init — the local
   * Steam client and this process are both still alive, so there is no dead
   * handle to reconnect to. Never auto-retries: `steamInit` short-circuits
   * once already connected, so polling it again would just report success
   * from the same stale session.
   */
  | "disconnected";

export interface SteamInitError {
  kind: SteamInitFailure;
  /** Steam's own text, for the detail line — not the copy to act on. */
  message: string;
  /** Whether the launcher should keep retrying by itself. */
  autoRetry: boolean;
  /** Automatic re-checks to make before asking the user to act; null = keep going. */
  autoRetryLimit: number | null;
}

/**
 * Connect to Steam. Rejects with a {@link SteamInitError}.
 *
 * Safe to call repeatedly — a live connection short-circuits in the backend, so
 * the startup prompt can poll this until Steam appears.
 */
export async function steamInit(): Promise<void> {
  return invoke<void>("steam_init");
}

/**
 * Narrow an unknown rejection from {@link steamInit} into the typed payload.
 *
 * A rejection that isn't our struct (a panic, a serialisation failure) still has
 * to render something, and it must not claim to be retryable — an unrecognised
 * failure that the poll loop keeps hammering is the worst of both.
 */
export function asSteamInitError(e: unknown): SteamInitError {
  if (typeof e === "object" && e !== null && "kind" in e) {
    const err = e as Partial<SteamInitError>;
    return {
      kind: err.kind ?? "internal",
      message: err.message ?? "",
      autoRetry: err.autoRetry === true,
      autoRetryLimit: err.autoRetryLimit ?? null,
    };
  }
  return { kind: "internal", message: String(e), autoRetry: false, autoRetryLimit: 0 };
}

/** Start the Steam client. Returns as soon as the process is spawned. */
export async function openSteam(): Promise<void> {
  return invoke<void>("open_steam");
}

/**
 * Whether the live Steam backend connection is still up.
 *
 * Cheap enough to poll on a short interval: a local atomic read, not a round
 * trip through the Steam actor thread. `false` before `steamInit` has ever
 * succeeded is normal, not an error.
 */
export async function steamConnectionState(): Promise<boolean> {
  return invoke<boolean>("steam_connection_state");
}

/**
 * Mirrors the Rust `ModState`. `not_subscribed` deliberately does not claim the
 * item is invalid — Steam returns the same empty state for "a real mod you
 * never subscribed to" and "this id is not a workshop item", and the two cannot
 * be distinguished from `item_state`.
 */
export type ModState =
  | "ready"
  | "needs_update"
  | "downloading"
  | "not_installed"
  | "not_subscribed"
  /** Server-side or locally-installed mod with no Workshop id. Not actionable. */
  | "not_on_workshop";

export interface ModStateEntry {
  workshop_id: string;
  state: ModState;
}

export async function steamModStates(workshopIds: string[]): Promise<ModStateEntry[]> {
  return invoke<ModStateEntry[]>("steam_mod_states", { workshopIds });
}

export interface DownloadProgress {
  workshop_id: string;
  /** Strings: byte counts can exceed JS's safe integer range. */
  downloaded: string;
  total: string;
}

/**
 * Progress for whichever items Steam is actively transferring. Items with no
 * transfer are omitted, so an empty array means nothing is downloading.
 */
export async function steamDownloadProgress(
  workshopIds: string[],
): Promise<DownloadProgress[]> {
  return invoke<DownloadProgress[]>("steam_download_progress", { workshopIds });
}

export interface MutationOutcome {
  succeeded: number;
  /** `[workshop_id, reason]` per failed item — a batch can partially succeed. */
  failures: [string, string][];
}

export async function steamSubscribeMods(workshopIds: string[]): Promise<MutationOutcome> {
  return invoke<MutationOutcome>("steam_subscribe_mods", { workshopIds });
}

/**
 * Destructive — Steam deletes the content from disk. Confirm before calling.
 */
export async function steamUnsubscribeMods(workshopIds: string[]): Promise<MutationOutcome> {
  return invoke<MutationOutcome>("steam_unsubscribe_mods", { workshopIds });
}

// ── Settings Commands ──

/**
 * Mirrors the Rust `AppSettings`, which serialises in camelCase so the two
 * shapes stay identical.
 */
export interface AppSettingsDto {
  profileName: string;
  steamPath: string | null;
  dayzPath: string | null;
  workshopPath: string | null;
  maxConcurrentQueries: number;
  queryTimeoutMs: number;
  launchParams: string[];
  /** The close button hides the launcher to the tray instead of quitting. */
  closeToTray: boolean;
  /** The minimise button hides to the tray instead of the taskbar. */
  minimiseToTray: boolean;
  /** Interface scale, as a webview zoom factor. 1.0–1.5. */
  uiScale: number;
  /** Seconds between automatic refreshes of the visible rows. `0` is off. */
  autoRefreshIntervalSecs: number;
  autoJoinAfterDownload: boolean;
  /** Hide hosting-company defaults like "nitrado.net gameserver". */
  hidePlaceholderServers: boolean;
  /** ENGLISH ONLY, remembered across restarts. `null` does not filter. */
  englishNamesFilter: boolean | null;
  /** Register the launcher to start with Windows. No-op in debug builds. */
  startWithWindows: boolean;
  /** Start hidden in the tray. Only applies when Windows did the starting. */
  startMinimised: boolean;
  /** What the launcher does with itself once DayZ is starting. */
  onJoin: OnJoin;
  /** Show "Playing on {server}" / "Browsing servers" in Discord. */
  discordRichPresence: boolean;
}

/** Matches the Rust `OnJoin` enum, which serialises lowercase. */
export type OnJoin = "stay" | "tray" | "close";

/** The range the Rust side clamps `uiScale` to. Keep the two in step. */
export const UI_SCALE_MIN = 1.0;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_STEP = 0.05;

export async function getSettings(): Promise<AppSettingsDto> {
  return invoke<AppSettingsDto>("get_settings");
}

/**
 * Apply the interface scale without persisting it.
 *
 * Dragging a slider fires a change per pixel of travel; each one is a webview
 * zoom (cheap) but would also be a settings write and a file rewrite (not).
 * The store's own debounced save handles persistence.
 */
export async function setUiScale(scale: number): Promise<void> {
  return invoke<void>("set_ui_scale", { scale });
}

export async function saveSettings(settings: AppSettingsDto): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

// ── Launch Commands ──

/** What a pre-launch verification found. Mirrors the Rust `VerifyOutcome`. */
export interface VerifyOutcome {
  /** The server's mod list as it declares it right now, in declared order. */
  mods: { workshop_id: string; name: string }[];
  /** Workshop ids a fresh copy was queued for. */
  refreshed: string[];
  /**
   * Whether Steam was reachable enough to check freshness. `false` means
   * `refreshed` is empty because nothing was asked, not because everything was
   * already current.
   */
  checked_workshop: boolean;
}

/**
 * Re-read a server's mod list and update any local copy the Workshop has moved
 * past. Does not launch anything.
 */
export async function verifyServerMods(
  addr: string,
  queryPort: number,
): Promise<VerifyOutcome> {
  return invoke<VerifyOutcome>("verify_server_mods", { addr, queryPort });
}

export interface LaunchOutcome {
  status: string;
  mods_checked: number;
  mods_ready: number;
  mods_needing_action: number;
  message: string;
}

export interface LaunchOptions {
  password?: string;
  profileName?: string;
  dayzPath?: string;
  /** Extra DayZ command-line flags, e.g. `-noSplash`. Placed before `-mod=`. */
  launchParams?: string[];
  /**
   * Launch to the main menu with the mods loaded instead of joining the server.
   * Skips the auto-connect args; the mod gate still runs.
   */
  mainMenu?: boolean;
}

/**
 * Run the pre-launch mod gate and start DayZ.
 *
 * Resolves as soon as the process has been spawned — it does not wait for the
 * play session to end.
 *
 * Takes an options object rather than five positional optionals: the previous
 * signature was `(addr, gamePort, password, profileName, dayzPath)`, and every
 * call site passed `undefined` for `password` just to reach the two it cared
 * about.
 */
export async function launchGame(
  addr: string,
  gamePort: number,
  options: LaunchOptions = {},
): Promise<LaunchOutcome> {
  return invoke<LaunchOutcome>("launch_game", {
    addr,
    gamePort,
    password: options.password ?? null,
    profileName: options.profileName ?? null,
    dayzPathOverride: options.dayzPath ?? null,
    launchParams: options.launchParams ?? null,
    mainMenu: options.mainMenu ?? null,
  });
}

export async function getServerMods(
  addr: string,
  queryPort: number,
): Promise<{ workshop_id: string; name: string }[]> {
  return invoke<{ workshop_id: string; name: string }[]>("get_server_mods", {
    addr,
    queryPort,
  });
}

export async function discoverSteamPaths(): Promise<{
  steam_install: string;
  dayz_install: string;
  workshop_dir: string;
} | null> {
  return invoke("discover_steam_paths");
}

/**
 * Where this copy keeps `tetra.db` and `settings.json`.
 *
 * Depends on how the launcher was distributed — beside the exe for a portable
 * copy carrying `portable.txt`, in local app data for an installed one — so it
 * is asked for rather than constructed in the frontend.
 */
export async function dataFolderPath(): Promise<string> {
  return invoke<string>("data_folder_path");
}

/** Show the data folder in Explorer. */
export async function openDataFolder(): Promise<void> {
  return invoke("open_data_folder");
}

/**
 * Whether a DayZ process exists right now.
 *
 * Asked of the OS rather than inferred from having launched one, so it is also
 * true for a session started outside the launcher.
 */
export async function dayzRunning(): Promise<boolean> {
  return invoke<boolean>("dayz_running");
}

// ── Mods Tab Commands ──

/** One row of the Mods tab, as the backend enumerates it. */
export interface SubscribedMod {
  /** Stringified — Workshop ids exceed JS's safe integer range. */
  workshop_id: string;
  locally_disabled: boolean;
  /** No longer answered by the Workshop; hidden from the list, offered as clean-up. */
  removed: boolean;
  /** Belongs to a DayZ appid (221100/245340). */
  for_dayz: boolean;
  state: ModState;
  /** Bytes on disk for this item. */
  size_on_disk: string;
  /** When Steam reports it was installed (unix seconds). */
  install_timestamp: number;
  folder: string | null;
  downloaded: string | null;
  total: string | null;
  title: string | null;
  preview_url: string | null;
  description: string | null;
  tags: string[];
  workshop_url: string | null;
  consumer_app_id: number | null;
  time_created: number;
  time_updated: number;
  /** When the user subscribed, when Steam records it (0 otherwise). */
  time_added_to_user_list: number;
  file_size: number;
  num_subscriptions: string;
  num_upvotes: number;
  num_downvotes: number;
  score: number;
}

export interface ModsListOutcome {
  rows: SubscribedMod[];
  /** True when nothing live was asked (Steam offline) and the last snapshot is shown. */
  from_cache: boolean;
}

/** Load the subscribed-mod list for the Mods tab. */
export async function getSubscribedMods(forceDetails = false): Promise<ModsListOutcome> {
  return invoke<ModsListOutcome>("get_subscribed_mods", { forceDetails: forceDetails });
}

/** One mod's verdict from a VERIFY pass. */
export interface SubscribedModVerifyOutcome {
  workshop_id: string;
  /** The Workshop answered at all (false = couldn't check). */
  known: boolean;
  /** Workshop copy newer than disk, or nothing on disk. */
  outdated: boolean;
  /** A download was queued for it. */
  queued: boolean;
}

/** VERIFY the given subscribed mods against the Workshop. */
export async function verifySubscribedMods(
  workshopIds: string[],
): Promise<SubscribedModVerifyOutcome[]> {
  return invoke<SubscribedModVerifyOutcome[]>("verify_subscribed_mods", {
    workshopIds: workshopIds,
  });
}

/** "Needed by N servers" for the given mods. */
export interface ModUsage {
  workshop_id: string;
  /** Every server in the registry that declares this mod. */
  total_servers: number;
  /** Favourited servers that declare it — what the details pane counts. */
  favourite_servers: number;
}

export async function getModUsage(workshopIds: string[]): Promise<ModUsage[]> {
  return invoke<ModUsage[]>("get_mod_usage", { workshopIds: workshopIds });
}

/** A server the user cares about (favourite or recently played). */
export interface CaredServer {
  /** Bare IP, no port. */
  addr: string;
  query_port: number;
  name: string;
}

export async function getCaredServers(): Promise<CaredServer[]> {
  return invoke<CaredServer[]>("get_cared_servers");
}

/** A mod as a server declares it. */
export interface ServerModRef {
  workshop_id: string;
  name: string;
}

/** Mods the given server declares that no other cared server also declares. */
export async function getUniqueModsFor(
  addr: string,
  queryPort: number,
): Promise<ServerModRef[]> {
  return invoke<ServerModRef[]>("get_unique_mods_for", { addr: addr, queryPort: queryPort });
}

/** One server that needs a given mod, for the details inspector. */
export interface ServerNeeding {
  addr: string;
  query_port: number;
  name: string;
  last_played: number | null;
}

/** Which servers in the browser need this mod. */
export async function getServersNeeding(workshopId: string): Promise<ServerNeeding[]> {
  return invoke<ServerNeeding[]>("get_servers_needing", { workshopId: workshopId });
}

/** Force a fresh download of one mod (clears its folder first) — the honest
    repair for a corrupt copy, since Steam exposes no checksum check. */
export async function reinstallSubscribedMod(workshopId: string): Promise<void> {
  return invoke<void>("reinstall_subscribed_mod", { workshopId: workshopId });
}

/** Open a mod's Workshop page in the Steam client itself (focuses Steam). */
export async function openWorkshopInSteam(workshopId: string): Promise<void> {
  return invoke<void>("open_workshop_in_steam", { workshopId: workshopId });
}

/** Reveal a mod's install folder in the system file manager. */
export async function openModFolder(folder: string): Promise<void> {
  return invoke<void>("open_mod_folder", { folder: folder });
}

/** Append a line from the frontend to `tetra-launcher.log` (see `crate::log`).
    Level is a free-form tag like "startup" / "reload" / "servers".
    `verbose` marks a hot-path line (every reload, every list load) that
    should only actually write in a debug build — see
    `crate::log::log_line_verbose`. Defaults to `false`. */
export async function logClient(
  level: string,
  message: string,
  verbose = false,
): Promise<void> {
  try {
    await invoke<void>("log_client", { level: level, message: message, verbose: verbose });
  } catch {
    // Logging must never break the launcher.
  }
}
