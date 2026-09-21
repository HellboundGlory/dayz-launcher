import type { Server } from "@/types/server";

const MAPS: [string, string][] = [
  ["chernarusplus", "Chernarus"],
  ["enoch", "Livonia"],
  ["sakhal", "Sakhal"],
  ["deerisle", "Deer Isle"],
  ["namalsk", "Namalsk"],
  ["banov", "Banov"],
];

const NAMES = [
  "! X-RED4CTED-X- Gaming™ PVE Console Version",
  "RED HORIZON | NEW SERVER | CHERNARUS | Vanilla+ PvP",
  "TUNDRA Project # Chernarus 3PP VANILLA++",
  "STALKER ESP | RP [BETA ABIERTA] Discord.gg/jGnhDRZyV2",
  "Lost Lands PVE | RoamingAI | Quests | Terje 6/16",
  "~TheBoredFam~ PVE - Ver 0.05 Hardcore/Skills/Medicine/Crafts",
  "~=Republic of Texas=~ #2 TakistanPlus | PvP/PvE/AI | 1PP",
  "|WIPED 8/8| Backcountry Gaming |PVP-24/7RAID-4MAN-QUESTS-KEYS|",
  "DayZ LA 5711 (Public)",
  "Esseker Wasteland",
];

const REGIONS = ["EU", "NA", "EU", "AS", "OC", "SA"];

export const maps = MAPS;

export function makeServers(count: number): Server[] {
  const servers: Server[] = [];
  for (let i = 0; i < count; i++) {
    const [, map] = MAPS[i % MAPS.length];
    const max = [20, 40, 60, 80, 100][i % 5];
    const players = i % 7 === 0 ? 0 : i % 11 === 0 ? max : (i * 13) % max;
    const modded = i % 4 !== 3;
    servers.push({
      addr: `${45 + (i % 200)}.${(i * 7) % 255}.${(i * 13) % 255}.${(i * 31) % 255}:${2302 + (i % 5)}`,
      game_port: 2302 + (i % 5),
      query_port: 27016 + (i % 5),
      name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` #${i}` : ""}`,
      map_display: map,
      players,
      max_players: max,
      ping: i % 9 === 0 ? null : 20 + ((i * 37) % 230),
      locked: i % 13 === 0,
      vac: i % 3 === 0,
      version: "1.29.163709",
      in_game_time: `${(i * 5) % 24}:${String((i * 17) % 60).padStart(2, "0")}`,
      queue: i % 17 === 0 ? 3 : null,
      day_multiplier: [1, 2, 4, 6, 12][i % 5],
      night_multiplier: [1, 2, 8][i % 3],
      mod_count: modded ? (i % 6 === 0 ? null : (i * 7) % 90) : 0,
      country_code: REGIONS[i % REGIONS.length],
      last_played: i % 5 === 0 ? Math.floor(Date.now() / 1000) - i * 3600 : null,
      favourite: i % 8 === 0,
      official: i % 10 === 8,
      modded,
      first_person: i % 6 === 2,
      battleye: i % 2 === 0,
      online: i % 12 !== 5,
    });
  }
  return servers;
}

const MOD_NAMES = ["AgricultureCore", "AutoCarFlipLegacy", "Automated Turrets", "BallerZ Gear", "BaseBuildingPlus", "CF", "Code Lock", "DayZ-Expansion-Core"];

export function makeMods() {
  const now = Math.floor(Date.now() / 1000);
  return MOD_NAMES.map((title, i) => ({
    workshop_id: String(1559212036 + i),
    locally_disabled: i === 6,
    removed: false,
    for_dayz: true,
    state: i === 2 ? "needs_update" : i === 4 ? "downloading" : "ready",
    size_on_disk: String((i + 1) * 37_000_000),
    install_timestamp: now - i * 86_400 * 30,
    folder: `/home/user/.local/share/Steam/steamapps/workshop/content/221100/${1559212036 + i}`,
    downloaded: i === 4 ? "40000000" : null,
    total: i === 4 ? "120000000" : null,
    title,
    preview_url: null,
    description: `${title} description.`,
    tags: ["Mod", "Weapon", "Character"].slice(0, (i % 3) + 1),
    workshop_url: null,
    consumer_app_id: 221100,
    time_created: now - i * 86_400 * 400,
    time_updated: now - i * 86_400 * 20,
    time_added_to_user_list: now - i * 86_400 * 25,
  }));
}
