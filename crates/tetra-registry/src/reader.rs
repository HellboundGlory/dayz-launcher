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
            .query_map(rusqlite::params_from_iter(binds), Self::map_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Look up a single server by its key — the same row `list()` would
    /// return for it, without building a filter for one address.
    ///
    /// Used to attach a server's current name/map/player-count to Discord
    /// Rich Presence right after a launch, where the caller only has the
    /// address it just spawned DayZ against.
    pub fn get(&self, key: ServerKey) -> Result<Option<ServerListRow>, RegistryError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {SERVER_LIST_COLUMNS} FROM servers WHERE ip = ?1 AND query_port = ?2"
        ))?;
        let row = stmt
            .query_map(params![key.ip.to_string(), key.query_port], Self::map_row)?
            .next()
            .transpose()?;
        Ok(row)
    }

    /// Shared row mapping for [`Reader::list`] and [`Reader::get`] — both read
    /// the same [`SERVER_LIST_COLUMNS`] in the same order.
    fn map_row(r: &rusqlite::Row) -> rusqlite::Result<ServerListRow> {
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
            queue: r.get(21)?,
            day_multiplier: r.get(22)?,
            night_multiplier: r.get(23)?,
        })
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

    /// For each of `ids`, how many servers in the registry declare it — and how
    /// many of those are the user's favourites.
    ///
    /// The total is the honest blast radius of unsubscribing: Workshop items are
    /// shared, so removing a mod breaks *every* server that lists it, not just
    /// the favourites. The favourite count is what the Mods tab's details pane
    /// shows ("needed by N servers"), scoped to favourites per James's round-3
    /// direction.
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
    /// played, most recently played first then by name.
    ///
    /// This two-way "cared about" set is what the Mods tab's unique-per-server
    /// tool compares against — the servers James actually joins, not the whole
    /// registry. See [`mod_usage`](Self::mod_usage) for the count counterpart.
    pub fn cared_servers(&self) -> Result<Vec<(ServerKey, String)>, RegistryError> {
        let mut stmt = self.conn.prepare(
            "SELECT ip, query_port, name FROM servers
             WHERE favourite = 1 OR last_played IS NOT NULL
             ORDER BY last_played IS NULL, last_played DESC, name",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let ip: String = r.get(0)?;
                Ok((
                    ServerKey {
                        ip: Ipv4Addr::from_str(&ip).unwrap_or(Ipv4Addr::UNSPECIFIED),
                        query_port: r.get(1)?,
                    },
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The mods one server declares that no other *cared* server also declares.
    ///
    /// This is the "select mods unique to this server" tool: mods only this
    /// server uses among the servers the user cares about, which is what makes
    /// them safe to unsubscribe without breaking a favourite or a recent one.
    /// A mod can be present on some anonymous browser server and still come
    /// back as unique here — those aren't servers whose mod sets are being
    /// reasoned about.
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
    /// played first.
    ///
    /// Feeds the Mods tab's details inspector: "Needed by N servers" is scoped
    /// to favourites per James's round-3 direction. `None` last_played means
    /// the favourite is known but never joined.
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
        let rows = stmt
            .query_map(params![workshop_id as i64], |r| {
                let ip: String = r.get(0)?;
                Ok((
                    ServerKey {
                        ip: Ipv4Addr::from_str(&ip).unwrap_or(Ipv4Addr::UNSPECIFIED),
                        query_port: r.get(1)?,
                    },
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}
