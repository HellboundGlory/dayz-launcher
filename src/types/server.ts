export interface Server {
  addr: string;
  game_port: number;
  query_port: number;
  name: string;
  map_display: string;
  players: number;
  max_players: number;
  ping: number | null;
  locked: boolean;
  vac: boolean;
  version: string;
  in_game_time: string | null;
  /** Join-queue size (`lqs`). `null` means the server didn't report one. */
  queue: number | null;
  /** Day (`etm`) and night (`entm`) time-acceleration multipliers. */
  day_multiplier: number | null;
  night_multiplier: number | null;
  /** Mods declared over A2S_RULES. `null` means "not probed yet", not "no mods" — check `modded` to tell them apart. */
  mod_count: number | null;
  country_code: string | null;
  last_played: number | null;
  favourite: boolean;
  official: boolean;
  modded: boolean;
  first_person: boolean;
  battleye: boolean;
  /** `false` only after a targeted REFRESH misses this server. */
  online: boolean;
}

export interface ServerModReadiness {
  stale: boolean;
  mods: ModReadinessEntry[];
}

export interface ModReadinessEntry {
  workshop_id: string;
  name: string;
  state: import("../lib/tauri").ModState;
  /** File size in bytes: null if already ready or unknown. */
  size_bytes: number | null;
  /** True if this size is an upper bound (ADR-0021: mod needs update). */
  size_is_upper_bound: boolean;
  preview_url: string | null;
  is_unique: boolean;
  downloaded_bytes: number | null;
  total_bytes: number | null;
}