use crate::error::RegistryError;
use crate::filter::{self, ServerFilter, ServerListRow, SortDir, SortKey};
use crate::rows::ServerKey;
use rusqlite::functions::FunctionFlags;
use rusqlite::{params, Connection};
use std::net::Ipv4Addr;
use std::str::FromStr;
use tetra_core::a2s::dayz::ServerMod;
use tetra_core::classify::maps::display_name;
use tetra_core::classify::names::{is_english_name, is_placeholder_name};

/// Expose the name classifiers to SQL as `tetra_is_placeholder(name)` and
/// `tetra_is_english(name)`.
///
/// Registered per read connection rather than baked into a column, which is the
/// pattern the tag flags (`official`, `modded`) use. Those are derived at write
/// time because they come from `keywords`, which only a probe supplies. These
/// come from `name`, which every row already has — so a stored column would
/// need a migration *and* a backfill, and would read as stale until every
/// server had been re-probed. As functions the filters apply correctly to the
/// whole existing registry the moment the build lands.
///
/// `DETERMINISTIC` lets SQLite hoist and cache calls; the classifiers are pure.
fn register_name_functions(conn: &Connection) -> Result<(), RegistryError> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function("tetra_is_placeholder", 1, flags, |ctx| {
        Ok(is_placeholder_name(ctx.get_raw(0).as_str().unwrap_or("")))
    })?;
    conn.create_scalar_function("tetra_is_english", 1, flags, |ctx| {
        Ok(is_english_name(ctx.get_raw(0).as_str().unwrap_or("")))
    })?;
    Ok(())
}

pub struct Reader {
    conn: Connection,
}

impl Reader {
    pub(crate) fn new(conn: Connection) -> Result<Self, RegistryError> {
        register_name_functions(&conn)?;
        Ok(Self { conn })
    }

    /// `(total, populated)` — every known server, and how many have a player on
    /// them right now.
    ///
    /// One statement rather than two. This replaces a `count()` plus a
    /// `raw().query_row("SELECT COUNT(*) ... WHERE players > 0")` issued from
    /// the Tauri command layer: two full scans where one does, and a query
    /// written outside the one crate that is supposed to own all SQL. `raw()`
    /// existed only to permit that and is gone with it.
    pub fn counts(&self) -> Result<(usize, usize), RegistryError> {
        let (total, populated): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(*), COUNT(*) FILTER (WHERE players > 0) FROM servers",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok((total as usize, populated as usize))
    }

    pub fn list(
        &self,
        filter: &ServerFilter,
        sort: SortKey,
        dir: SortDir,
        limit: usize,
    ) -> Result<Vec<ServerListRow>, RegistryError> {
        let (sql, binds) = filter::build(filter, sort, dir, limit);
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                let ip: String = r.get(0)?;
                let map_raw: String = r.get(4)?;
                Ok(ServerListRow {
                    key: ServerKey {
                        ip: Ipv4Addr::from_str(&ip).unwrap_or(Ipv4Addr::UNSPECIFIED),
                        query_port: r.get(1)?,
                    },
                    game_port: r.get(2)?,
                    name: r.get(3)?,
                    map_display: display_name(&map_raw),
                    players: r.get(5)?,
                    max_players: r.get(6)?,
                    mod_count: r.get(7)?,
                    ping_ms: r.get(8)?,
                    locked: r.get::<_, i64>(9)? != 0,
                    in_game_time: r.get(10)?,
                    country_code: r.get(11)?,
                    last_played: r.get(12)?,
                    favourite: r.get::<_, i64>(13)? != 0,
                    official: r.get::<_, i64>(14)? != 0,
                    first_person: r.get::<_, i64>(15)? != 0,
                    modded: r.get::<_, i64>(16)? != 0,
                    battleye: r.get::<_, i64>(17)? != 0,
                    vac: r.get::<_, i64>(18)? != 0,
                    version: r.get(19)?,
                    online: r.get::<_, i64>(20)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn distinct_maps(&self) -> Result<Vec<(String, String)>, RegistryError> {
        let mut stmt = self.conn.prepare(
            "SELECT map_normalised, MIN(map_raw) FROM servers
             WHERE map_normalised <> ''
             GROUP BY map_normalised
             ORDER BY map_normalised",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let normalised: String = r.get(0)?;
                let raw: String = r.get(1)?;
                Ok((normalised, display_name(&raw)))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn mods_for(&self, key: ServerKey) -> Result<Vec<ServerMod>, RegistryError> {
        let mut stmt = self.conn.prepare(
            "SELECT workshop_id, name FROM server_mods
             WHERE ip = ?1 AND query_port = ?2
             ORDER BY ordinal",
        )?;
        let rows = stmt
            .query_map(params![key.ip.to_string(), key.query_port], |r| {
                Ok(ServerMod {
                    workshop_id: r.get::<_, i64>(0)? as u64,
                    name: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}
