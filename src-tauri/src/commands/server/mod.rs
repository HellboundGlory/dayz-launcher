use crate::state::AppState;
use std::net::Ipv4Addr;
use std::sync::Arc;
use tauri::State;
use tetra_net::Prober;
use tetra_registry::filter::{ModMatch, ServerFilter, SortDir, SortKey};
use tetra_registry::rows::ServerKey;

pub(crate) mod discovery;
pub(crate) mod lookup;
pub(crate) mod mod_readiness;
pub(crate) mod probe;

pub(crate) use mod_readiness::resolve_workshop_cache;

/// Borrow the process-wide `Prober` from application state. Every probing
/// path goes through this: a `Prober` owns its concurrency limit, so the
/// process shares one limit only while it shares one `Prober`.
fn prober(state: &AppState) -> Result<Prober, String> {
    let guard = state.prober.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().ok_or("Prober not initialized")?.clone())
}

/// Open a read connection, releasing the state lock before returning. The
/// tight scope matters twice over: the `!Send` guard can't cross an
/// `.await`, and a `Reader` owning its own connection means handing it to a
/// blocking task keeps no lock at all.
pub(crate) fn reader(state: &AppState) -> Result<tetra_registry::Reader, String> {
    let guard = state.registry.lock().map_err(|e| e.to_string())?;
    guard
        .as_ref()
        .ok_or("Registry not initialized")?
        .reader()
        .map_err(|e| e.to_string())
}

/// The shared reader `blocking_read` uses, cloning the `Arc` so it can be
/// moved into `spawn_blocking` without borrowing `AppState` across it.
/// Seeded on first use and kept, since this is the hottest read path.
fn reader_pool(state: &AppState) -> Result<Arc<std::sync::Mutex<tetra_registry::Reader>>, String> {
    let mut pool = state.server_reader.lock().map_err(|e| e.to_string())?;
    if let Some(r) = pool.as_ref() {
        return Ok(Arc::clone(r));
    }
    let fresh = reader(state)?;
    let shared = Arc::new(std::sync::Mutex::new(fresh));
    *pool = Some(Arc::clone(&shared));
    Ok(shared)
}

/// Run a blocking registry read off the main thread, against the pooled
/// reader connection. Every query command must go through this — a
/// non-`async` command's SQLite work would otherwise run inline between
/// paint frames, freezing the window while the table repopulates.
pub(crate) async fn blocking_read<T, F>(state: &AppState, work: F) -> Result<T, String>
where
    F: FnOnce(&tetra_registry::Reader) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    let pool = reader_pool(state)?;
    tokio::task::spawn_blocking(move || {
        let reader = pool.lock().map_err(|e| e.to_string())?;
        work(&reader)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Serializable server type for the Tauri bridge (32-bit safe).
#[derive(serde::Serialize, Clone)]
pub struct Server32 {
    pub addr: String,
    pub game_port: u32,
    pub query_port: u32,
    pub name: String,
    // No raw `map`: only the display name is carried, to avoid a silent name/display mix-up.
    pub map_display: String,
    pub players: i32,
    pub max_players: i32,
    pub ping: Option<i32>,
    pub locked: bool,
    pub vac: bool,
    pub version: String,
    // No `keywords`: everything derived from it is already on the row as a flag.
    pub in_game_time: Option<String>,
    pub mod_count: Option<i32>,
    pub country_code: Option<String>,
    pub last_played: Option<i64>,
    pub favourite: bool,
    pub official: bool,
    pub modded: bool,
    pub first_person: bool,
    pub battleye: bool,
    /// Whether the last targeted refresh that reached for this server got an answer.
    pub online: bool,
    /// Players waiting in the join queue. `0` = no queue, `null` = server didn't report one.
    pub queue: Option<i32>,
    /// Day/night time-acceleration multipliers, for the `Nx` shown next to the in-game time.
    pub day_multiplier: Option<f32>,
    pub night_multiplier: Option<f32>,
}

#[derive(serde::Deserialize)]
pub struct FilterParams {
    pub maps: Vec<String>,
    pub countries: Vec<String>,
    pub hide_empty: bool,
    pub hide_full: bool,
    pub hide_locked: bool,
    // Defaulted so an older frontend still deserialises, showing offline servers rather than hiding them.
    #[serde(default)]
    pub hide_offline: bool,
    pub max_ping: Option<i32>,
    pub search: Option<String>,
    pub favourites_only: bool,
    #[serde(default)]
    pub recent_only: bool,
    pub official: Option<bool>,
    pub modded: Option<bool>,
    pub first_person: Option<bool>,
    /// Stringified Workshop ids from the "Filter by mod" modal — JS safe-integer
    /// range, same reason every other workshop id crosses the bridge as a string.
    #[serde(default)]
    pub mod_ids: Vec<String>,
    /// "any" or "all"; anything else (including omission) means "any".
    #[serde(default)]
    pub mod_match: String,
    /// Stringified Workshop ids to keep off the list — a server declaring any
    /// one of these is dropped, independent of `mod_match`.
    #[serde(default)]
    pub mod_ids_exclude: Vec<String>,
}

#[derive(serde::Deserialize)]
pub struct PageParams {
    pub sort_key: String,
    pub sort_dir: String,
    pub offset: usize,
    pub limit: usize,
}

/// One page of the list, plus how many rows the filter matches in all.
#[derive(serde::Serialize)]
pub struct ServerPage {
    pub total: usize,
    pub rows: Vec<Server32>,
}

/// Map a registry row onto the bridge type. Classification flags come
/// straight off the row rather than being re-derived here, since they were
/// computed once at write time and the filter SQL matches those same columns.
fn to_server32(r: &tetra_registry::filter::ServerListRow) -> Server32 {
    Server32 {
        addr: format!("{}:{}", r.key.ip, r.key.query_port),
        game_port: r.game_port as u32,
        query_port: r.key.query_port as u32,
        name: r.name.clone(),
        map_display: r.map_display.clone(),
        players: r.players,
        max_players: r.max_players,
        ping: (r.ping_ms > 0).then_some(r.ping_ms),
        locked: r.locked,
        vac: r.vac,
        version: r.version.clone().unwrap_or_default(),
        in_game_time: r.in_game_time.clone(),
        mod_count: r.mod_count,
        country_code: r.country_code.clone(),
        last_played: r.last_played,
        favourite: r.favourite,
        official: r.official,
        modded: r.modded,
        first_person: r.first_person,
        battleye: r.battleye,
        online: r.online,
        queue: r.queue,
        day_multiplier: r.day_multiplier,
        night_multiplier: r.night_multiplier,
    }
}

/// Largest page one `get_server_page` call returns.
const MAX_PAGE_LIMIT: usize = 2_000;

/// One page of the filtered, sorted list, with the total the filter matches.
#[tauri::command]
pub async fn get_server_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    filter_params: FilterParams,
    page: PageParams,
) -> Result<ServerPage, String> {
    let started = std::time::Instant::now();
    crate::log::log_line_verbose(&app, "servers", "get_server_page: start");
    let limit = page.limit.min(MAX_PAGE_LIMIT);
    let result: Result<ServerPage, String> = blocking_read(&state, move |reader| {
        let filter = filter_from_params(filter_params);
        let (sort_key, sort_dir) = sort_from_params(&page.sort_key, &page.sort_dir);
        let (total, rows) = reader
            .page_with_total(&filter, sort_key, sort_dir, page.offset, limit)
            .map_err(|e| e.to_string())?;
        Ok(ServerPage {
            total,
            rows: rows.iter().map(to_server32).collect(),
        })
    })
    .await;
    match &result {
        Ok(loaded) => crate::log::log_line_verbose(
            &app,
            "servers",
            &format!(
                "get_server_page: {} of {} rows in {:?}",
                loaded.rows.len(),
                loaded.total,
                started.elapsed()
            ),
        ),
        Err(e) => crate::log::log_line(
            &app,
            "servers",
            &format!("get_server_page: error after {:?}: {e}", started.elapsed()),
        ),
    }
    result
}

/// Look up a single server by address, regardless of whatever filter/sort
/// the table currently has loaded. Exists for the `dzsa://` deep-link flow,
/// where the named server may not be in the frontend's currently-loaded rows.
#[tauri::command]
pub async fn get_server(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
) -> Result<Option<Server32>, String> {
    let key = server_key(&addr, query_port)?;
    blocking_read(&state, move |reader| {
        Ok(reader
            .get(key)
            .map_err(|e| e.to_string())?
            .map(|row| to_server32(&row)))
    })
    .await
}

/// Largest number of addresses one `get_servers_by_addr` call accepts.
const MAX_ADDRS: usize = 2_000;

/// Rows for `"ip:query_port"` addresses, in no particular order. An entry
/// that doesn't parse is skipped; addresses the registry doesn't hold are absent.
#[tauri::command]
pub async fn get_servers_by_addr(
    state: State<'_, AppState>,
    addrs: Vec<String>,
) -> Result<Vec<Server32>, String> {
    if addrs.len() > MAX_ADDRS {
        return Err("too many addresses".into());
    }
    let keys: Vec<ServerKey> = addrs
        .iter()
        .filter_map(|addr| {
            let (_, port) = addr.rsplit_once(':')?;
            server_key(addr, port.parse().ok()?).ok()
        })
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    blocking_read(&state, move |reader| {
        let rows = reader.get_many(&keys).map_err(|e| e.to_string())?;
        Ok(rows.iter().map(to_server32).collect())
    })
    .await
}

/// Set a server's favourite flag, persisted in the registry. Errors if
/// `addr` isn't a known row, rather than silently succeeding on a no-op
/// `UPDATE` — the frontend's optimistic toggle reverts on `Err`.
#[tauri::command]
pub async fn toggle_favourite(
    state: State<'_, AppState>,
    addr: String,
    query_port: u16,
    favourite: bool,
) -> Result<(), String> {
    let key = server_key(&addr, query_port)?;
    let writer = {
        let guard = state.registry.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("Registry not initialized")?.writer()
    };
    let affected = writer
        .set_favourite(key, favourite)
        .await
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(format!("{addr} is not in the registry yet"));
    }
    Ok(())
}

/// Registry counts for the footer.
#[derive(serde::Serialize)]
pub struct ServerCounts {
    pub total: usize,
    pub populated: usize,
}

#[tauri::command]
pub async fn get_server_counts(state: State<'_, AppState>) -> Result<ServerCounts, String> {
    blocking_read(&state, |reader| {
        let (total, populated) = reader.counts().map_err(|e| e.to_string())?;
        Ok(ServerCounts { total, populated })
    })
    .await
}

/// Whether the registry fell back to in-memory storage at startup (app
/// works, but forgets everything on exit) — see the fallback in `lib.rs`.
#[tauri::command]
pub fn registry_degraded(state: State<AppState>) -> Result<bool, String> {
    state
        .registry_degraded
        .lock()
        .map(|flag| *flag)
        .map_err(|e| e.to_string())
}

/// Get map list from registry.
#[tauri::command]
pub async fn get_map_list(state: State<'_, AppState>) -> Result<Vec<(String, String)>, String> {
    blocking_read(&state, |reader| {
        reader.distinct_maps().map_err(|e| e.to_string())
    })
    .await
}

// ── helpers ─────────────────────────────────────────────────────

/// Build a `ServerKey` from the bridge's `"IP:query_port"` string. Only the
/// IP is read from it — `query_port` is taken as authoritative.
pub(crate) fn server_key(addr: &str, query_port: u16) -> Result<ServerKey, String> {
    let ip: Ipv4Addr = addr
        .split(':')
        .next()
        .ok_or_else(|| format!("Invalid address: {addr}"))?
        .parse()
        .map_err(|_| format!("Invalid IP in address: {addr}"))?;
    Ok(ServerKey { ip, query_port })
}

fn filter_from_params(p: FilterParams) -> ServerFilter {
    ServerFilter {
        maps: p.maps,
        countries: p.countries,
        hide_empty: p.hide_empty,
        hide_full: p.hide_full,
        hide_locked: p.hide_locked,
        hide_offline: p.hide_offline,
        max_ping_ms: p.max_ping,
        search: p.search,
        favourites_only: p.favourites_only,
        recent_only: p.recent_only,
        official: p.official,
        modded: p.modded,
        first_person: p.first_person,
        // Not a setting — a never-probed row has no name/players/map, so showing it is only noise.
        hide_unnamed: true,
        // Not a setting: a server that has gone quiet is not listed as if it were up.
        hide_stale: true,
        mod_ids: p.mod_ids.iter().filter_map(|id| id.parse().ok()).collect(),
        mod_match: if p.mod_match == "all" {
            ModMatch::All
        } else {
            ModMatch::Any
        },
        mod_ids_exclude: p
            .mod_ids_exclude
            .iter()
            .filter_map(|id| id.parse().ok())
            .collect(),
    }
}

fn sort_from_params(sort_key: &str, sort_dir: &str) -> (SortKey, SortDir) {
    let key = match sort_key {
        "players" => SortKey::Players,
        "ping" => SortKey::Ping,
        "mod_count" => SortKey::ModCount,
        "name" => SortKey::Name,
        "map" => SortKey::Map,
        "last_played" => SortKey::LastPlayed,
        _ => SortKey::Players,
    };
    let dir = match sort_dir {
        "asc" => SortDir::Asc,
        _ => SortDir::Desc,
    };
    (key, dir)
}

#[cfg(test)]
mod tests {
    use super::server_key;

    /// Pins the wire convention: `addr` already carries `"IP:query_port"`, so
    /// appending the port again would build an invalid double-port string.
    #[test]
    fn an_address_already_carrying_a_port_is_not_given_a_second_one() {
        let key = server_key("172.111.51.137:27022", 27022).expect("should parse");
        assert_eq!(key.ip.to_string(), "172.111.51.137");
        assert_eq!(key.query_port, 27022);

        let socket = std::net::SocketAddr::from((key.ip, key.query_port));
        assert_eq!(socket.to_string(), "172.111.51.137:27022");
    }

    /// `query_port` is authoritative over the port embedded in the string.
    #[test]
    fn the_separate_query_port_wins_over_the_one_in_the_string() {
        let key = server_key("1.2.3.4:9999", 2303).expect("should parse");
        assert_eq!(key.query_port, 2303);
    }

    #[test]
    fn a_malformed_address_is_rejected_rather_than_guessed_at() {
        assert!(server_key("not-an-ip:2303", 2303).is_err());
        assert!(server_key("", 2303).is_err());
    }

    fn default_params() -> super::FilterParams {
        super::FilterParams {
            maps: vec![],
            countries: vec![],
            hide_empty: false,
            hide_full: false,
            hide_locked: false,
            hide_offline: false,
            max_ping: None,
            search: None,
            favourites_only: false,
            recent_only: false,
            official: None,
            modded: None,
            first_person: None,
            mod_ids: vec![],
            mod_match: String::new(),
            mod_ids_exclude: vec![],
        }
    }

    #[tokio::test]
    async fn mod_filter_from_the_real_bridge_still_lets_search_narrow_the_list() {
        use std::net::Ipv4Addr;
        use tetra_core::a2s::dayz::ServerMod;
        use tetra_registry::{Registry, ServerKey, ServerRow, SortDir, SortKey};

        let registry = Registry::open_in_memory().expect("registry");
        let writer = registry.writer();
        let a = ServerKey {
            ip: Ipv4Addr::new(203, 0, 113, 10),
            query_port: 27016,
        };
        let b = ServerKey {
            ip: Ipv4Addr::new(203, 0, 113, 11),
            query_port: 27016,
        };
        writer
            .upsert_servers(vec![
                ServerRow {
                    key: a,
                    name: "Vertex PvP".into(),
                    responded: true,
                    ..Default::default()
                },
                ServerRow {
                    key: b,
                    name: "Vertex RP".into(),
                    responded: true,
                    ..Default::default()
                },
            ])
            .await
            .expect("servers");
        writer
            .upsert_server_mods(
                a,
                vec![ServerMod {
                    workshop_id: 1,
                    name: "CF".into(),
                }],
            )
            .await
            .expect("mods a");
        writer
            .upsert_server_mods(
                b,
                vec![ServerMod {
                    workshop_id: 1,
                    name: "CF".into(),
                }],
            )
            .await
            .expect("mods b");

        let reader = registry.reader().expect("reader");

        let mut params = default_params();
        params.mod_ids = vec!["1".to_string()];
        params.mod_match = "any".to_string();
        let filter = super::filter_from_params(params);
        let rows = reader
            .page(&filter, SortKey::Name, SortDir::Asc, 0, 10)
            .expect("page");
        assert_eq!(rows.len(), 2, "mod filter alone should match both");

        let mut params = default_params();
        params.mod_ids = vec!["1".to_string()];
        params.mod_match = "any".to_string();
        params.search = Some("PvP".to_string());
        let filter = super::filter_from_params(params);
        let rows = reader
            .page(&filter, SortKey::Name, SortDir::Asc, 0, 10)
            .expect("page");
        assert_eq!(
            rows.len(),
            1,
            "adding a search term through the real FilterParams bridge should narrow the mod-filtered list"
        );
        assert_eq!(rows[0].name, "Vertex PvP");
    }

    #[test]
    fn filter_params_map_onto_the_registry_filter() {
        let mut p = default_params();
        p.search = Some("pvp".into());
        p.maps = vec!["chernarus".into(), "livonia".into()];
        p.countries = vec!["DE".into()];
        p.max_ping = Some(120);
        p.hide_empty = true;
        p.hide_full = true;
        p.hide_locked = true;
        p.hide_offline = true;
        p.favourites_only = true;
        p.recent_only = true;
        p.official = Some(true);
        p.modded = Some(false);
        p.first_person = Some(true);
        p.mod_ids = vec!["123".into(), "456".into(), "not-a-number".into()];
        p.mod_ids_exclude = vec!["789".into(), "bad".into()];

        let f = super::filter_from_params(p);

        assert_eq!(f.search.as_deref(), Some("pvp"));
        assert_eq!(f.maps, vec!["chernarus", "livonia"]);
        assert_eq!(f.countries, vec!["DE"]);
        assert_eq!(f.max_ping_ms, Some(120));
        assert!(f.hide_empty && f.hide_full && f.hide_locked && f.hide_offline);
        assert!(f.favourites_only && f.recent_only);
        assert_eq!(f.official, Some(true));
        assert_eq!(f.modded, Some(false));
        assert_eq!(f.first_person, Some(true));
        assert_eq!(f.mod_ids, vec![123, 456]);
        assert_eq!(f.mod_ids_exclude, vec![789]);
        // A never-probed row has nothing to show, so the list always hides it.
        assert!(f.hide_unnamed);
        assert!(f.hide_stale);
    }

    #[test]
    fn mod_match_all_is_the_only_value_that_requires_every_mod() {
        use tetra_registry::filter::ModMatch;

        let mut p = default_params();
        p.mod_match = "all".into();
        assert_eq!(super::filter_from_params(p).mod_match, ModMatch::All);

        for value in ["any", "", "ALL", "nonsense"] {
            let mut p = default_params();
            p.mod_match = value.into();
            assert_eq!(
                super::filter_from_params(p).mod_match,
                ModMatch::Any,
                "mod_match {value:?} should mean any"
            );
        }
    }

    #[test]
    fn sort_params_map_every_key_and_direction_with_a_players_desc_fallback() {
        use tetra_registry::filter::{SortDir, SortKey};

        for (key, expected) in [
            ("players", SortKey::Players),
            ("ping", SortKey::Ping),
            ("mod_count", SortKey::ModCount),
            ("name", SortKey::Name),
            ("map", SortKey::Map),
            ("last_played", SortKey::LastPlayed),
        ] {
            assert_eq!(
                super::sort_from_params(key, "asc"),
                (expected, SortDir::Asc),
                "key {key}"
            );
        }

        assert_eq!(
            super::sort_from_params("name", "desc"),
            (SortKey::Name, SortDir::Desc)
        );

        // Anything but "asc" sorts descending, and an unknown key sorts by players.
        assert_eq!(
            super::sort_from_params("nonsense", "sideways"),
            (SortKey::Players, SortDir::Desc)
        );
    }
}
