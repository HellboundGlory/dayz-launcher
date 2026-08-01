use crate::rows::ServerKey;
use rusqlite::types::Value;

#[derive(Debug, Clone, Default)]
pub struct ServerFilter {
    pub maps: Vec<String>,
    pub countries: Vec<String>,
    pub hide_empty: bool,
    pub hide_full: bool,
    pub hide_locked: bool,
    pub unresponsive_after_secs: Option<i64>,
    pub max_ping_ms: Option<i32>,
    pub search: Option<String>,
    pub favourites_only: bool,
    /// Restrict to servers that have actually been joined (`last_played` set).
    pub recent_only: bool,
    pub official: Option<bool>,
    pub modded: Option<bool>,
    pub first_person: Option<bool>,
    /// Drop servers with no name at all.
    ///
    /// These are rows Steam listed but that have never answered a probe, so
    /// `name` was never written. They always read 0 players and are a quarter
    /// of a typical registry — the single largest source of clutter in the
    /// browser.
    pub hide_unnamed: bool,
    /// Drop hosting-company defaults and template names — see
    /// `tetra_core::classify::names::is_placeholder_name`.
    pub hide_placeholder: bool,
    /// Keep only names that read in Latin script.
    ///
    /// `Some(true)` is the ENGLISH ONLY tag; `Some(false)` inverts it, which is
    /// how a player who *wants* the Chinese or Russian servers finds them.
    pub latin_names: Option<bool>,
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
    /// servers in.
    ///
    /// Sorting refresh targets by player count alone is a starvation bug: a
    /// server that has never been probed has `players = 0`, so it sorts last,
    /// and once the registry grows past the probe window it can never be
    /// reached. It also can't be healed from the Steam side, because rows that
    /// fail Steam's own query arrive with `responded = false` and are ignored
    /// by the upsert guard. It would stay blank forever. Probing the
    /// never-responded rows first makes the window a rotation rather than a
    /// permanent cut-off.
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
    if filter.favourites_only {
        clauses.push("favourite = 1".into());
    }
    if filter.recent_only {
        clauses.push("last_played IS NOT NULL".into());
    }
    if let Some(secs) = filter.unresponsive_after_secs {
        clauses.push("last_responded IS NOT NULL AND last_responded >= unixepoch() - ?".into());
        binds.push(Value::Integer(secs));
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
    // Name-based noise filters. `tetra_is_placeholder`/`tetra_is_latin` are
    // registered on every read connection — see `reader::register_name_functions`.
    if filter.hide_unnamed {
        clauses.push("TRIM(name) <> ''".into());
    }
    if filter.hide_placeholder {
        clauses.push("NOT tetra_is_placeholder(name)".into());
    }
    if let Some(latin) = filter.latin_names {
        // An unnamed row has nothing to read either way, so it must not be
        // dragged in by `Some(false)` — that would make "show me the non-English
        // servers" return two thousand blanks.
        clauses.push(if latin {
            "tetra_is_latin(name)".into()
        } else {
            "(NOT tetra_is_latin(name) AND TRIM(name) <> '')".to_string()
        });
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
        "SELECT ip, query_port, game_port, name, map_raw, players, max_players,
                mod_count, ping_ms, locked, in_game_time, country_code,
                last_played, favourite,
                official, first_person, modded, battleye, vac, version, online
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
