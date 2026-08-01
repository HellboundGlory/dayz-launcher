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
  keywords: string | null;
  in_game_time: string | null;
  /**
   * Number of mods the server declared over A2S_RULES.
   *
   * `null` means "not probed yet", NOT "no mods" — the rules query is separate
   * from the info query and only runs in phase 2 of a refresh. Combine with
   * `modded` (which comes from the cheap info query) to tell the two apart:
   * `modded && mod_count === null` is a modded server awaiting its probe.
   */
  mod_count: number | null;
  country_code: string | null;
  last_played: number | null;
  favourite: boolean;
  official: boolean;
  modded: boolean;
  first_person: boolean;
  battleye: boolean;
  mod_list: Mod[] | null;
  /**
   * Whether the last targeted refresh that reached for this server got an
   * answer. `true` for anything only ever seen through discovery or a bulk
   * refresh — it only ever goes `false` from a REFRESH click that missed it.
   */
  online: boolean;
}

export interface Mod {
  workshop_id: string;
  name: string;
  install_state: string | null;
  size_on_disk: number | null;
  install_path: string | null;
}