import { invoke } from "@tauri-apps/api/core";
import type { Server } from "@/types/server";

// ── Server Commands ──

export interface FilterParams {
  maps: string[];
  countries: string[];
  hide_empty: boolean;
  hide_full: boolean;
  hide_locked: boolean;
  max_ping: number | null;
  search: string | null;
  favourites_only: boolean;
  recent_only: boolean;
  official: boolean | null;
  modded: boolean | null;
  first_person: boolean | null;
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

export async function toggleFavourite(
  addr: string,
  queryPort: number,
  favourite: boolean,
): Promise<void> {
  return invoke<void>("toggle_favourite", { addr, queryPort, favourite });
}

export async function refreshServers(filter?: FilterParams): Promise<void> {
  return invoke<void>("refresh_servers", {
    filterParams: filter ?? null,
  });
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
  closeToTray: boolean;
  autoRefreshIntervalSecs: number;
  autoJoinAfterDownload: boolean;
}

export async function getSettings(): Promise<AppSettingsDto> {
  return invoke<AppSettingsDto>("get_settings");
}

export async function saveSettings(settings: AppSettingsDto): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

// ── Launch Commands ──

export interface LaunchOutcome {
  status: string;
  mods_checked: number;
  mods_ready: number;
  mods_needing_action: number;
  message: string;
}

export async function launchGame(
  addr: string,
  gamePort: number,
  password?: string,
  profileName?: string,
  dayzPath?: string,
): Promise<LaunchOutcome> {
  return invoke<LaunchOutcome>("launch_game", {
    addr,
    gamePort,
    password: password ?? null,
    profileName: profileName ?? null,
    dayzPathOverride: dayzPath ?? null,
  });
}

export async function launchVanilla(
  addr: string,
  port: number,
): Promise<void> {
  return invoke<void>("launch_vanilla", { addr, port });
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
