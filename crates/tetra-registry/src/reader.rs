use crate::error::RegistryError;
use crate::filter::{self, ServerFilter, ServerListRow, SortDir, SortKey, SERVER_LIST_COLUMNS};
use crate::rows::ServerKey;
use rusqlite::functions::FunctionFlags;
use rusqlite::{params, Connection};
use std::net::Ipv4Addr;
use std::str::FromStr;
use tetra_core::a2s::dayz::ServerMod;
use tetra_core::classify::maps::display_name;
use tetra_core::classify::names::{is_english_name, is_placeholder_name};

/// Expose the name classifiers to SQL as `tetra_is_placeholder(name)` and `tetra_is_english(name)`.
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

/// Collects `query_map` results where `None` marks a row to drop, logging once if any were skipped.
fn collect_skipping_bad_rows<T>(
    rows: impl Iterator<Item = rusqlite::Result<Option<T>>>,
    context: &str,
) -> rusqlite::Result<Vec<T>> {
    let mut skipped = 0usize;
    let out = rows
        .filter_map(|r| match r {
            Ok(Some(v)) => Some(Ok(v)),
            Ok(None) => {
                skipped += 1;
                None
            }
            Err(e) => Some(Err(e)),
        })
        .collect::<rusqlite::Result<Vec<T>>>()?;
    if skipped > 0 {
        eprintln!("[registry] {context}: skipped {skipped} row(s) with an unparseable ip");
    }
    Ok(out)
}

pub struct Reader {
    conn: Connection,
}

impl Reader {
    pub(crate) fn new(conn: Connection) -> Result<Self, RegistryError> {
        register_name_functions(&conn)?;
        Ok(Self { conn })
    }

    /// `(total, populated)` — every known server, and how many have a player
    /// on them right now. One statement rather than two full scans.
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
        // prepare_cached: this is the hottest read path (fires on every
        // discovery tick), and filter shapes are a small, bounded set.
        let mut stmt = self.conn.prepare_cached(&sql)?;
        let rows = collect_skipping_bad_rows(
            stmt.query_map(rusqlite::params_from_iter(binds), Self::map_row)?,
            "list",
        )?;
        Ok(rows)
    }

    /// Look up a single server by key — the same row `list()` would return, without a filter.
    pub fn get(&self, key: ServerKey) -> Result<Option<ServerListRow>, RegistryError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {SERVER_LIST_COLUMNS} FROM servers WHERE ip = ?1 AND query_port = ?2"
        ))?;
        // A corrupt `ip` here just means "not found" — one row, no skip count to report.
        let row = stmt
            .query_map(params![key.ip.to_string(), key.query_port], Self::map_row)?
            .next()
            .transpose()?
            .flatten();
        Ok(row)
    }

    /// Shared row mapping for [`Reader::list`] and [`Reader::get`]. Returns `Ok(None)` to drop a
    /// row whose `ip` doesn't parse, instead of rendering `0.0.0.0`.
    fn map_row(r: &rusqlite::Row) -> rusqlite::Result<Option<ServerListRow>> {
        let ip: String = r.get(0)?;
        let Ok(ip) = Ipv4Addr::from_str(&ip) else {
            return Ok(None);
        };
        let map_raw: String = r.get(4)?;
        Ok(Some(ServerListRow {
            key: ServerKey {
                ip,
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
            queue: r.get(21)?,
            day_multiplier: r.get(22)?,
            night_multiplier: r.get(23)?,
        }))
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

    /// For each id: how many servers declare it, and how many of those are favourites — the
    /// total is the real blast radius of unsubscribing, since mods are shared across servers.
    pub fn mod_usage(&self, ids: &[u64]) -> Result<Vec<(u64, usize, usize)>, RegistryError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<i64> = ids.iter().map(|&id| id as i64).collect();
        let placeholders = std::iter::repeat_n("?", ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT sm.workshop_id,
                    COUNT(DISTINCT sm.ip || ':' || sm.query_port),
                    COUNT(DISTINCT sm.ip || ':' || sm.query_port)
                        FILTER (WHERE s.favourite = 1)
             FROM server_mods sm
             JOIN servers s ON s.ip = sm.ip AND s.query_port = sm.query_port
             WHERE sm.workshop_id IN ({placeholders})
             GROUP BY sm.workshop_id"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(ids), |r| {
                Ok((
                    r.get::<_, i64>(0)? as u64,
                    r.get::<_, i64>(1)? as usize,
                    r.get::<_, i64>(2)? as usize,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Servers the user has signalled interest in: favourites plus recently
    /// played, most recently played first then by name. This "cared about"
    /// set is what the Mods tab's unique-per-server tool compares against.
    pub fn cared_servers(&self) -> Result<Vec<(ServerKey, String)>, RegistryError> {
        let mut stmt = self.conn.prepare(
            "SELECT ip, query_port, name FROM servers
             WHERE favourite = 1 OR last_played IS NOT NULL
             ORDER BY last_played IS NULL, last_played DESC, name",
        )?;
        // A corrupt `ip` is dropped, not substituted
        // with `0.0.0.0` — see `collect_skipping_bad_rows`.
        let rows = collect_skipping_bad_rows(
            stmt.query_map([], |r| {
                let ip: String = r.get(0)?;
                let Ok(ip) = Ipv4Addr::from_str(&ip) else {
                    return Ok(None);
                };
                Ok(Some((
                    ServerKey {
                        ip,
                        query_port: r.get(1)?,
                    },
                    r.get::<_, String>(2)?,
                )))
            })?,
            "cared_servers",
        )?;
        Ok(rows)
    }

    /// Mods unique to this server among the servers the user cares about (favourites/recent) —
    /// safe to unsubscribe without breaking another cared-about server.
    pub fn unique_mods_for(&self, key: ServerKey) -> Result<Vec<(u64, String)>, RegistryError> {
        let mut stmt = self.conn.prepare(
            "SELECT sm.workshop_id, sm.name
             FROM server_mods sm
             WHERE sm.ip = ?1 AND sm.query_port = ?2
               AND NOT EXISTS (
                   SELECT 1
                   FROM server_mods other
                   JOIN servers os ON os.ip = other.ip AND os.query_port = other.query_port
                   WHERE other.workshop_id = sm.workshop_id
                     AND NOT (other.ip = ?1 AND other.query_port = ?2)
                     AND (os.favourite = 1 OR os.last_played IS NOT NULL)
               )
             GROUP BY sm.workshop_id, sm.name
             ORDER BY sm.name",
        )?;
        let rows = stmt
            .query_map(params![key.ip.to_string(), key.query_port], |r| {
                Ok((r.get::<_, i64>(0)? as u64, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Which *favourite* servers declare a given Workshop item, most recently
    /// played first. `None` last_played means the favourite is known but
    /// never joined.
    pub fn servers_needing(
        &self,
        workshop_id: u64,
    ) -> Result<Vec<(ServerKey, String, Option<i64>)>, RegistryError> {
        let mut stmt = self.conn.prepare(
            "SELECT s.ip, s.query_port, s.name, s.last_played
             FROM server_mods sm
             JOIN servers s ON s.ip = sm.ip AND s.query_port = sm.query_port
             WHERE sm.workshop_id = ?1 AND s.favourite = 1
             ORDER BY s.last_played IS NULL, s.last_played DESC",
        )?;
        // A corrupt `ip` is dropped, not substituted
        // with `0.0.0.0` — see `collect_skipping_bad_rows`.
        let rows = collect_skipping_bad_rows(
            stmt.query_map(params![workshop_id as i64], |r| {
                let ip: String = r.get(0)?;
                let Ok(ip) = Ipv4Addr::from_str(&ip) else {
                    return Ok(None);
                };
                Ok(Some((
                    ServerKey {
                        ip,
                        query_port: r.get(1)?,
                    },
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                )))
            })?,
            "servers_needing",
        )?;
        Ok(rows)
    }
}
