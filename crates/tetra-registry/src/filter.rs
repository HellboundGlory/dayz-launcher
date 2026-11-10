use crate::rows::ServerKey;
use rusqlite::types::Value;
use std::net::Ipv4Addr;
use tetra_core::classify::maps::engine_names_matching;
use tetra_core::classify::names::DEFAULT_NAMES;
use tetra_core::PingKind;

/// The column list (and order) both [`build`]'s query and [`crate::reader::Reader::get`]
/// select — kept in one place so the two queries cannot drift apart from the
/// row-mapping closure that reads them positionally.
pub(crate) const SERVER_LIST_COLUMNS: &str =
    "ip, query_port, game_port, name, map_raw, players, max_players,
                mod_count, ping_ms, locked, in_game_time, country_code,
                last_played, favourite,
                official, first_person, modded, battleye, vac, version, online,
                queue, day_multiplier, night_multiplier, ping_kind";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ModMatch {
    /// Server must declare at least one of `mod_ids`.
    #[default]
    Any,
    /// Server must declare every id in `mod_ids`.
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeOfDay {
    Day,
    Night,
}

/// How recently a server must have answered to be listed, unless it is a favourite or was played.
pub(crate) const ANSWERED_WITHIN_SECS: i64 = 86_400;

#[derive(Debug, Clone, Default)]
pub struct ServerFilter {
    pub maps: Vec<String>,
    pub countries: Vec<String>,
    pub hide_empty: bool,
    pub hide_full: bool,
    pub hide_locked: bool,
    /// Drop servers the last targeted refresh could not reach (`online = 0`).
    pub hide_offline: bool,
    pub max_ping_ms: Option<i32>,
    pub search: Option<String>,
    pub favourites_only: bool,
    /// Restrict to servers that have actually been joined (`last_played` set).
    pub recent_only: bool,
    pub official: Option<bool>,
    pub modded: Option<bool>,
    pub first_person: Option<bool>,
    /// Drop servers with no name at all — rows Steam listed but that have
    /// never answered a probe, so `name` was never written.
    pub hide_unnamed: bool,
    /// Keep only servers that answered within [`ANSWERED_WITHIN_SECS`] under a
    /// real name, plus favourites and played servers. Address searches skip it.
    pub hide_stale: bool,
    /// Workshop ids picked in the "Filter by mod" modal. Empty means no filter.
    pub mod_ids: Vec<u64>,
    /// Whether a server must declare all of `mod_ids` or just one.
    pub mod_match: ModMatch,
    /// Workshop ids to keep off the list entirely — a server declaring any one
    /// of these is dropped, regardless of `mod_match`. Independent of
    /// `mod_ids`: a mod can be required, excluded, or neither, never both.
    pub mod_ids_exclude: Vec<u64>,
    /// A dayz build string like `"1.29.161000"`; `None` matches any version.
    pub version: Option<String>,
    /// In-game clock half of the day; `None` matches any hour.
    pub time_of_day: Option<TimeOfDay>,
    /// `Some(true)` keeps only BattlEye servers, `Some(false)` only the rest.
    pub battleye: Option<bool>,
    /// Restrict the list to exactly these servers, whatever else the filter
    /// says. `None` adds nothing; `Some(vec![])` matches nothing.
    pub only: Option<Vec<ServerKey>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortKey {
    Players,
    Ping,
    ModCount,
    Name,
    Map,
    LastPlayed,
    /// A to Z by country name in either direction; a row with no country follows the rest.
    Country,
    /// Not a user-facing sort — the order the *refresh* should work through
    /// servers in. Never-responded rows go first so they rotate through the
    /// probe window instead of being permanently starved by player-count sort.
    RefreshPriority,
}

impl SortKey {
    /// The `ORDER BY` term. The caller appends the direction, so a composite
    /// term spells out the direction of every column but its last.
    fn column(self) -> &'static str {
        match self {
            SortKey::Players => "players",
            SortKey::Ping => "ping_ms",
            SortKey::ModCount => "mod_count",
            SortKey::Name => "name",
            SortKey::Map => "map_normalised",
            SortKey::LastPlayed => "last_played",
            SortKey::Country => "(country_order IS NULL) ASC, country_order",
            SortKey::RefreshPriority => "(last_responded IS NULL) DESC, players",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDir {
    Asc,
    Desc,
}

impl SortDir {
    fn sql(self) -> &'static str {
        match self {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerListRow {
    pub key: ServerKey,
    pub game_port: u16,
    pub name: String,
    pub map_display: String,
    pub players: i32,
    pub max_players: i32,
    pub mod_count: Option<i32>,
    pub ping_ms: i32,
    /// Where [`Self::ping_ms`] came from; the row shows a mark for anything but `Measured`.
    pub ping_kind: PingKind,
    pub locked: bool,
    pub in_game_time: Option<String>,
    pub country_code: Option<String>,
    pub last_played: Option<i64>,
    pub favourite: bool,
    /// Classification flags, already derived from `keywords` at write time.
    /// Carried here so the UI can render OFFICIAL/1PP/MODDED badges without
    /// re-parsing keywords — the filter SQL already reads the same columns.
    pub official: bool,
    pub first_person: bool,
    pub modded: bool,
    pub battleye: bool,
    pub vac: bool,
    pub version: Option<String>,
    /// Whether the last *targeted* A2S refresh that touched this server got an
    /// answer. `true` for anything only ever seen through Steam discovery or a
    /// bulk refresh — see the `online` column comment in `schema.rs`.
    pub online: bool,
    /// Players waiting in the join queue (`lqs` keyword). `Some(0)` means "no
    /// queue"; `None` means the server didn't report one.
    pub queue: Option<i32>,
    /// Day (`etm`) and night (`entm`) time-acceleration multipliers, from the
    /// A2S_INFO keywords. Used with `in_game_time` to show sun/moon + "Nx".
    pub day_multiplier: Option<f32>,
    pub night_multiplier: Option<f32>,
    /// The first declared mod whose name matched a search word, when no other
    /// field did. Filled by [`crate::Reader::page`], which is the only caller
    /// that has the mods at hand.
    pub matched_mod: Option<String>,
}

/// The `WHERE` clause (empty when nothing filters) and its binds. The page query
/// and the count both use it, so they always agree.
pub(crate) fn where_clause(filter: &ServerFilter) -> (String, Vec<Value>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<Value> = Vec::new();

    if !filter.maps.is_empty() {
        let holes = placeholders(&filter.maps, &mut binds);
        clauses.push(format!("map_normalised IN ({holes})"));
    }
    if !filter.countries.is_empty() {
        let holes = placeholders(&filter.countries, &mut binds);
        clauses.push(format!("country_code IN ({holes})"));
    }
    if filter.hide_empty {
        clauses.push("players > 0".into());
    }
    if filter.hide_full {
        clauses.push("players < max_players".into());
    }
    if filter.hide_locked {
        clauses.push("locked = 0".into());
    }
    if filter.hide_offline {
        clauses.push("online = 1".into());
    }
    if filter.favourites_only {
        clauses.push("favourite = 1".into());
    }
    if filter.recent_only {
        clauses.push("last_played IS NOT NULL".into());
    }
    match &filter.only {
        None => {}
        Some(keys) if keys.is_empty() => clauses.push("1 = 0".into()),
        Some(keys) => {
            let mut parts = Vec::with_capacity(keys.len());
            for key in keys {
                binds.push(Value::Text(key.ip.to_string()));
                binds.push(Value::Integer(key.query_port.into()));
                parts.push("(ip = ? AND query_port = ?)");
            }
            clauses.push(format!("({})", parts.join(" OR ")));
        }
    }
    let address = filter.search.as_deref().and_then(address_search);
    // Servers on a local network belong in LAN, Favourites and Recent only —
    // in the full list they would be a handful of the user's own machines
    // among thousands of internet servers. An explicit list, a saved tab or a
    // typed address replaces this.
    if filter.only.is_none() && !filter.favourites_only && !filter.recent_only && address.is_none()
    {
        clauses.push(PRIVATE_ADDRESS_SQL.into());
    }
    if let Some(ping) = filter.max_ping_ms {
        clauses.push("ping_ms <= ?".into());
        binds.push(Value::Integer(ping as i64));
    }
    for (want, column) in [
        (filter.official, "official"),
        (filter.modded, "modded"),
        (filter.first_person, "first_person"),
        (filter.battleye, "battleye"),
    ] {
        if let Some(v) = want {
            clauses.push(format!("{column} = ?"));
            binds.push(Value::Integer(v as i64));
        }
    }
    if let Some(day) = filter.time_of_day {
        clauses.push(time_of_day_sql(day).into());
    }
    if let Some(version) = filter.version.as_deref().and_then(clean_version) {
        let holes = placeholders(&version_prefixes(&version), &mut binds);
        clauses.push(format!(
            "(version IN ({holes}) OR version LIKE ? ESCAPE '\\')"
        ));
        binds.push(Value::Text(format!("{}.%", escape_like(&version))));
    }
    // Non-correlated on purpose: an `EXISTS`/`= ?` clause correlated to
    // `servers.ip`/`servers.query_port` re-runs its subquery once per outer
    // row, which turned an 8ms query into a 2-second one at 6,000 servers.
    // Matching by the `ip || ':' || query_port` key (same idiom `mod_usage`
    // already uses) lets SQLite compute the qualifying-server set once and
    // probe it with a hash/index lookup per outer row instead.
    if !filter.mod_ids.is_empty() {
        let mut mod_binds: Vec<Value> = Vec::new();
        let holes = std::iter::repeat_n("?", filter.mod_ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        for &id in &filter.mod_ids {
            mod_binds.push(Value::Integer(id as i64));
        }
        match filter.mod_match {
            ModMatch::Any => {
                clauses.push(format!(
                    "(ip || ':' || query_port) IN (SELECT sm.ip || ':' || sm.query_port \
                     FROM server_mods sm WHERE sm.workshop_id IN ({holes}))"
                ));
                binds.extend(mod_binds);
            }
            ModMatch::All => {
                clauses.push(format!(
                    "(ip || ':' || query_port) IN (SELECT sm.ip || ':' || sm.query_port \
                     FROM server_mods sm WHERE sm.workshop_id IN ({holes}) \
                     GROUP BY sm.ip, sm.query_port HAVING COUNT(DISTINCT sm.workshop_id) = ?)"
                ));
                binds.extend(mod_binds);
                binds.push(Value::Integer(filter.mod_ids.len() as i64));
            }
        }
    }
    if !filter.mod_ids_exclude.is_empty() {
        let holes = std::iter::repeat_n("?", filter.mod_ids_exclude.len())
            .collect::<Vec<_>>()
            .join(", ");
        clauses.push(format!(
            "(ip || ':' || query_port) NOT IN (SELECT sm.ip || ':' || sm.query_port \
             FROM server_mods sm WHERE sm.workshop_id IN ({holes}))"
        ));
        for &id in &filter.mod_ids_exclude {
            binds.push(Value::Integer(id as i64));
        }
    }
    if filter.hide_unnamed {
        clauses.push("TRIM(name) <> ''".into());
    }
    // A LAN scan just heard these servers, so a stock name must not hide them.
    if filter.hide_stale && address.is_none() && filter.only.is_none() {
        clauses.push(visible_sql());
    }
    if let Some(text) = &filter.search {
        match address {
            Some((ip, None)) => {
                clauses.push("ip = ?".into());
                binds.push(Value::Text(ip.to_string()));
            }
            Some((ip, Some(port))) => {
                clauses.push("ip = ? AND (query_port = ? OR game_port = ?)".into());
                binds.push(Value::Text(ip.to_string()));
                binds.push(Value::Integer(port.into()));
                binds.push(Value::Integer(port.into()));
            }
            None => {
                for term in search_terms(text) {
                    push_search_term(&term, &mut clauses, &mut binds);
                }
            }
        }
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    (where_sql, binds)
}

/// Drops every row whose stored address is private, loopback or link-local.
/// `ip` is dotted text, so the prefixes are matched as text.
pub(crate) const PRIVATE_ADDRESS_SQL: &str =
    "NOT (ip GLOB '10.*' OR ip GLOB '127.*' OR ip GLOB '192.168.*' \
     OR ip GLOB '169.254.*' OR ip GLOB '172.1[6-9].*' OR ip GLOB '172.2[0-9].*' \
     OR ip GLOB '172.3[01].*')";

/// The rule `hide_stale` applies, also used for the footer counts.
pub(crate) fn visible_sql() -> String {
    let names: Vec<String> = DEFAULT_NAMES
        .iter()
        .map(|name| format!("'{}'", name.replace('\'', "''")))
        .collect();
    format!(
        "(favourite = 1 OR last_played IS NOT NULL OR \
         (last_responded >= unixepoch() - {ANSWERED_WITHIN_SECS} AND LOWER(TRIM(name)) NOT IN ({})))",
        names.join(", ")
    )
}

/// One page of the list. `ip` and `query_port` break ties after the name, so
/// consecutive pages never repeat or skip a row that shares a sort value.
pub(crate) fn build(
    filter: &ServerFilter,
    sort: SortKey,
    dir: SortDir,
    offset: usize,
    limit: usize,
) -> (String, Vec<Value>) {
    let (where_sql, mut binds) = where_clause(filter);
    let sql = format!(
        "SELECT {SERVER_LIST_COLUMNS}
         FROM servers
         {where_sql}
         ORDER BY {} {} , name ASC, ip ASC, query_port ASC
         LIMIT ? OFFSET ?",
        sort.column(),
        dir.sql(),
    );
    binds.push(Value::Integer(i64::try_from(limit).unwrap_or(i64::MAX)));
    binds.push(Value::Integer(i64::try_from(offset).unwrap_or(i64::MAX)));
    (sql, binds)
}

/// An IPv4 address with an optional port (1–65535), when `text` is one.
pub fn address_search(text: &str) -> Option<(Ipv4Addr, Option<u16>)> {
    let text = text.trim();
    match text.rsplit_once(':') {
        Some((ip, port)) => {
            let port = port.parse::<u16>().ok().filter(|&p| p != 0)?;
            Some((ip.parse().ok()?, Some(port)))
        }
        None => Some((text.parse().ok()?, None)),
    }
}

/// Most words a single search is split into; beyond this the rest are ignored.
const MAX_SEARCH_TERMS: usize = 8;
/// Longest word kept from a search, in chars.
const MAX_TERM_CHARS: usize = 64;

/// The words of a search, at most [`MAX_SEARCH_TERMS`] of them, each capped at
/// [`MAX_TERM_CHARS`] chars. Blank text gives no words, so it filters nothing.
pub(crate) fn search_terms(text: &str) -> Vec<String> {
    text.split_whitespace()
        .filter_map(|word| {
            let capped: String = word.chars().take(MAX_TERM_CHARS).collect();
            (!capped.is_empty()).then_some(capped)
        })
        .take(MAX_SEARCH_TERMS)
        .collect()
}

/// One word's clause: it must appear somewhere on the server. Cheap string
/// tests come first so SQLite rarely has to run the `server_mods` subquery.
fn push_search_term(term: &str, clauses: &mut Vec<String>, binds: &mut Vec<Value>) {
    let pattern = format!("%{}%", escape_like(term));
    let mut parts = Vec::new();
    for column in ["name", "COALESCE(description, '')", "map_raw"] {
        parts.push(format!("{column} LIKE ? ESCAPE '\\'"));
        binds.push(Value::Text(pattern.clone()));
    }
    let map_keys: Vec<String> = engine_names_matching(term)
        .into_iter()
        .map(String::from)
        .collect();
    if !map_keys.is_empty() {
        parts.push(format!(
            "map_normalised IN ({})",
            placeholders(&map_keys, binds)
        ));
    }
    for address in ["(ip || ':' || query_port)", "(ip || ':' || game_port)"] {
        parts.push(format!("{address} LIKE ? ESCAPE '\\'"));
        binds.push(Value::Text(pattern.clone()));
    }
    parts.push(
        "(ip || ':' || query_port) IN (SELECT sm.ip || ':' || sm.query_port \
         FROM server_mods sm WHERE sm.name LIKE ? ESCAPE '\\')"
            .to_string(),
    );
    binds.push(Value::Text(pattern));
    clauses.push(format!("({})", parts.join(" OR ")));
}

/// Day is in-game hour 5 through 19; night is every other hour. A row without a
/// readable clock matches neither. The `instr > 1` guard keeps a stray string
/// with no `:` (which would cast to 0) from counting as night.
fn time_of_day_sql(t: TimeOfDay) -> &'static str {
    match t {
        TimeOfDay::Day => {
            "(in_game_time IS NOT NULL AND instr(in_game_time, ':') > 1 \
             AND CAST(substr(in_game_time, 1, instr(in_game_time, ':') - 1) AS INTEGER) \
             BETWEEN 5 AND 19)"
        }
        TimeOfDay::Night => {
            "(in_game_time IS NOT NULL AND instr(in_game_time, ':') > 1 \
             AND CAST(substr(in_game_time, 1, instr(in_game_time, ':') - 1) AS INTEGER) \
             NOT BETWEEN 5 AND 19)"
        }
    }
}

/// A version string worth matching on, trimmed and checked; anything else means
/// "no version filter" rather than "hide everything".
pub(crate) fn clean_version(v: &str) -> Option<String> {
    let v = v.trim();
    let ok = (1..=32).contains(&v.len())
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let edges_ok = !v.starts_with('.') && !v.ends_with('.');
    let no_empty_parts = v.split('.').all(|part| !part.is_empty());
    (ok && edges_ok && no_empty_parts).then(|| v.to_string())
}

/// The dotted prefixes of a clean version, itself last: `"1.29.161000"` gives
/// `"1"`, `"1.29"`, `"1.29.161000"`.
pub(crate) fn version_prefixes(v: &str) -> Vec<String> {
    let parts: Vec<&str> = v.split('.').collect();
    (1..=parts.len()).map(|n| parts[..n].join(".")).collect()
}

fn placeholders(items: &[String], binds: &mut Vec<Value>) -> String {
    for item in items {
        binds.push(Value::Text(item.clone()));
    }
    std::iter::repeat_n("?", items.len())
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn escape_like(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}
