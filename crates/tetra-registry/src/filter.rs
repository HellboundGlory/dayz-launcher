use crate::rows::ServerKey;
use rusqlite::types::Value;

/// The column list (and order) both [`build`]'s query and [`crate::reader::Reader::get`]
/// select — kept in one place so the two queries cannot drift apart from the
/// row-mapping closure that reads them positionally.
pub(crate) const SERVER_LIST_COLUMNS: &str =
    "ip, query_port, game_port, name, map_raw, players, max_players,
                mod_count, ping_ms, locked, in_game_time, country_code,
                last_played, favourite,
                official, first_person, modded, battleye, vac, version, online,
                queue, day_multiplier, night_multiplier";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ModMatch {
    /// Server must declare at least one of `mod_ids`.
    #[default]
    Any,
    /// Server must declare every id in `mod_ids`.
    All,
}

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
    /// Workshop ids picked in the "Filter by mod" modal. Empty means no filter.
    pub mod_ids: Vec<u64>,
    /// Whether a server must declare all of `mod_ids` or just one.
    pub mod_match: ModMatch,
    /// Workshop ids to keep off the list entirely — a server declaring any one
    /// of these is dropped, regardless of `mod_match`. Independent of
    /// `mod_ids`: a mod can be required, excluded, or neither, never both.
    pub mod_ids_exclude: Vec<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortKey {
    Players,
    Ping,
    ModCount,
    Name,
    Map,
    LastPlayed,
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
}

pub(crate) fn build(
    filter: &ServerFilter,
    sort: SortKey,
    dir: SortDir,
    limit: usize,
) -> (String, Vec<Value>) {
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
    if let Some(ping) = filter.max_ping_ms {
        clauses.push("ping_ms <= ?".into());
        binds.push(Value::Integer(ping as i64));
    }
    for (want, column) in [
        (filter.official, "official"),
        (filter.modded, "modded"),
        (filter.first_person, "first_person"),
    ] {
        if let Some(v) = want {
            clauses.push(format!("{column} = ?"));
            binds.push(Value::Integer(v as i64));
        }
    }
    // Non-correlated on purpose: an `EXISTS`/`= ?` clause correlated to
    // `servers.ip`/`servers.query_port` re-runs its subquery once per outer
    // row, which turned an 8ms query into a 2-second one at 6,000 servers —
    // see .ai-notes/crates/tetra-registry/src/filter.rs.md. Matching by the
    // `ip || ':' || query_port` key (same idiom `mod_usage` already uses)
    // lets SQLite compute the qualifying-server set once and probe it with a
    // hash/index lookup per outer row instead.
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
    // Name-based noise filters. `tetra_is_placeholder`/`tetra_is_english` are
    if filter.hide_unnamed {
        clauses.push("TRIM(name) <> ''".into());
    }
    if let Some(text) = &filter.search {
        clauses.push(
            "(name LIKE ? ESCAPE '\\' OR COALESCE(description, '') LIKE ? ESCAPE '\\')".into(),
        );
        let pattern = format!("%{}%", escape_like(text));
        binds.push(Value::Text(pattern.clone()));
        binds.push(Value::Text(pattern));
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    let sql = format!(
        "SELECT {SERVER_LIST_COLUMNS}
         FROM servers
         {where_sql}
         ORDER BY {} {} , name ASC
         LIMIT {}",
        sort.column(),
        dir.sql(),
        limit
    );

    (sql, binds)
}

fn placeholders(items: &[String], binds: &mut Vec<Value>) -> String {
    for item in items {
        binds.push(Value::Text(item.clone()));
    }
    std::iter::repeat_n("?", items.len())
        .collect::<Vec<_>>()
        .join(", ")
}

fn escape_like(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}
