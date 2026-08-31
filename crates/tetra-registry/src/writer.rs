use crate::error::RegistryError;
use crate::rows::{ServerKey, ServerRow};
use rusqlite::{params, Connection};
use tetra_core::a2s::dayz::ServerMod;
use tetra_core::classify::geoip::country_code as geo_country_code;
use tetra_core::classify::keywords::parse_keywords;
use tetra_core::classify::maps::normalise_map;
use tokio::sync::{mpsc, oneshot};

type Ack<T> = oneshot::Sender<Result<T, RegistryError>>;

pub(crate) enum Job {
    Servers(Vec<ServerRow>, Ack<usize>),
    ServerMods(ServerKey, Vec<ServerMod>, Ack<()>),
    Favourite(ServerKey, bool, Ack<usize>),
    LastPlayed(ServerKey, Ack<usize>),
    SetOnline(Vec<ServerKey>, bool, Ack<()>),
}

/// Handle to the single writer thread. Cheap to clone.
#[derive(Clone)]
pub struct Writer {
    tx: mpsc::Sender<Job>,
}

impl Writer {
    pub(crate) fn new(tx: mpsc::Sender<Job>) -> Self {
        Self { tx }
    }

    async fn send<T>(&self, make: impl FnOnce(Ack<T>) -> Job) -> Result<T, RegistryError> {
        let (ack, rx) = oneshot::channel();
        self.tx
            .send(make(ack))
            .await
            .map_err(|_| RegistryError::Closed)?;
        rx.await.map_err(|_| RegistryError::Closed)?
    }

    pub async fn upsert_servers(&self, rows: Vec<ServerRow>) -> Result<usize, RegistryError> {
        self.send(|ack| Job::Servers(rows, ack)).await
    }

    pub async fn upsert_server_mods(
        &self,
        key: ServerKey,
        mods: Vec<ServerMod>,
    ) -> Result<(), RegistryError> {
        self.send(|ack| Job::ServerMods(key, mods, ack)).await
    }

    /// Set or clear a server's favourite flag — a targeted `UPDATE`, not an upsert, so it can't
    /// touch the live columns. Returns the affected row count; `0` means `key` wasn't found.
    pub async fn set_favourite(
        &self,
        key: ServerKey,
        favourite: bool,
    ) -> Result<usize, RegistryError> {
        self.send(|ack| Job::Favourite(key, favourite, ack)).await
    }

    /// Stamp a server as played just now. Returns the affected row count.
    pub async fn mark_played(&self, key: ServerKey) -> Result<usize, RegistryError> {
        self.send(|ack| Job::LastPlayed(key, ack)).await
    }

    /// Flip `online` for a batch of servers — kept separate from `upsert_servers` since only a
    /// targeted A2S refresh calls this; a bulk refresh leaves `online` alone.
    pub async fn set_online(
        &self,
        keys: Vec<ServerKey>,
        online: bool,
    ) -> Result<(), RegistryError> {
        self.send(|ack| Job::SetOnline(keys, online, ack)).await
    }
}

pub(crate) fn run(conn: Connection, mut rx: mpsc::Receiver<Job>) {
    while let Some(job) = rx.blocking_recv() {
        match job {
            Job::Servers(rows, ack) => {
                let _ = ack.send(upsert_servers(&conn, &rows));
            }
            Job::ServerMods(key, mods, ack) => {
                let _ = ack.send(upsert_server_mods(&conn, key, &mods));
            }
            Job::Favourite(key, favourite, ack) => {
                let _ = ack.send(set_favourite(&conn, key, favourite));
            }
            Job::LastPlayed(key, ack) => {
                let _ = ack.send(mark_played(&conn, key));
            }
            Job::SetOnline(keys, online, ack) => {
                let _ = ack.send(set_online(&conn, &keys, online));
            }
        }
    }
}

const UPSERT_SERVER: &str = r#"
INSERT INTO servers (
    ip, query_port, game_port, name, map_raw, map_normalised,
    players, max_players, bots, ping_ms, locked, vac,
    version, keywords, description, in_game_time, mod_count,
    official, first_person, modded, battleye,
    first_seen, last_seen, last_responded, last_played, country_code,
    queue, day_multiplier, night_multiplier
) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6,
    ?7, ?8, ?9, ?10, ?11, ?12,
    ?13, ?14, ?15, ?16, ?17,
    ?18, ?19, ?20, ?21,
    unixepoch(), unixepoch(), ?22, ?23, ?24,
    ?25, ?26, ?27
)
ON CONFLICT(ip, query_port) DO UPDATE SET
    game_port      = CASE WHEN excluded.game_port > 0
                          THEN excluded.game_port
                          ELSE servers.game_port END,
    -- Live fields only overwrite on a row that actually got a response
    -- (last_responded IS NOT NULL) — a non-responding row carries structural
    -- zeroes, not measurements, and without this guard those zeroes clobber
    -- good data. `players = 0` is legitimate for an empty server, so the
    -- discriminator must be "did this row respond", not "is the value zero".
    name           = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.name
                          ELSE servers.name END,
    map_raw        = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.map_raw
                          ELSE servers.map_raw END,
    map_normalised = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.map_normalised
                          ELSE servers.map_normalised END,
    players        = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.players
                          ELSE servers.players END,
    max_players    = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.max_players
                          ELSE servers.max_players END,
    bots           = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.bots
                          ELSE servers.bots END,
    ping_ms        = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.ping_ms
                          ELSE servers.ping_ms END,
    locked         = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.locked
                          ELSE servers.locked END,
    vac            = CASE WHEN excluded.last_responded IS NOT NULL
                          THEN excluded.vac
                          ELSE servers.vac END,
    official       = CASE WHEN excluded.keywords IS NOT NULL
                          THEN excluded.official
                          ELSE servers.official END,
    first_person   = CASE WHEN excluded.keywords IS NOT NULL
                          THEN excluded.first_person
                          ELSE servers.first_person END,
    modded         = CASE WHEN excluded.keywords IS NOT NULL
                          THEN excluded.modded
                          ELSE servers.modded END,
    battleye       = CASE WHEN excluded.keywords IS NOT NULL
                          THEN excluded.battleye
                          ELSE servers.battleye END,
    last_seen      = excluded.last_seen,
    version        = COALESCE(excluded.version,        servers.version),
    keywords       = COALESCE(excluded.keywords,       servers.keywords),
    description    = COALESCE(excluded.description,    servers.description),
    in_game_time   = COALESCE(excluded.in_game_time,   servers.in_game_time),
    queue          = COALESCE(excluded.queue,          servers.queue),
    day_multiplier = COALESCE(excluded.day_multiplier, servers.day_multiplier),
    night_multiplier = COALESCE(excluded.night_multiplier, servers.night_multiplier),
    mod_count      = COALESCE(excluded.mod_count,      servers.mod_count),
    last_responded = COALESCE(excluded.last_responded, servers.last_responded),
    last_played    = COALESCE(excluded.last_played,    servers.last_played),
    country_code   = COALESCE(excluded.country_code,   servers.country_code)
"#;

fn upsert_servers(conn: &Connection, rows: &[ServerRow]) -> Result<usize, RegistryError> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    {
        let mut stmt = tx.prepare_cached(UPSERT_SERVER)?;
        for row in rows {
            let kw = row.keywords.as_deref().map(parse_keywords);
            let in_game_time = kw.as_ref().and_then(|k| k.in_game_time.clone());
            let queue = kw.as_ref().and_then(|k| k.queue).map(i64::from);
            let day_multiplier = kw.as_ref().and_then(|k| k.day_multiplier).map(f64::from);
            let night_multiplier = kw.as_ref().and_then(|k| k.night_multiplier).map(f64::from);
            let official = kw.as_ref().is_some_and(|k| k.official);
            let first_person = kw.as_ref().is_some_and(|k| k.first_person_only);
            let modded = kw.as_ref().is_some_and(|k| k.modded);
            let battleye = kw.as_ref().is_some_and(|k| k.battleye);
            let responded_at: Option<i64> = row.responded.then(now);

            let cc = row
                .country_code
                .as_deref()
                .or_else(|| geo_country_code(row.key.ip))
                .map(|s| s.to_string());

            n += stmt.execute(params![
                row.key.ip.to_string(),
                row.key.query_port,
                row.game_port,
                row.name,
                row.map,
                normalise_map(&row.map),
                row.players,
                row.max_players,
                row.bots,
                row.ping_ms,
                row.locked,
                row.vac,
                row.version,
                row.keywords,
                row.description,
                in_game_time,
                row.mod_count,
                official,
                first_person,
                modded,
                battleye,
                responded_at,
                row.last_played,
                cc,
                queue,
                day_multiplier,
                night_multiplier,
            ])?;
        }
    }
    tx.commit()?;
    Ok(n)
}

/// Replace a server's mod list and set `mod_count` — an empty slice writes `mod_count = 0`,
/// distinct from `NULL` (never probed).
fn upsert_server_mods(
    conn: &Connection,
    key: ServerKey,
    mods: &[ServerMod],
) -> Result<(), RegistryError> {
    let tx = conn.unchecked_transaction()?;
    let ip = key.ip.to_string();

    tx.execute(
        "DELETE FROM server_mods WHERE ip = ?1 AND query_port = ?2",
        params![ip, key.query_port],
    )?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO server_mods (ip, query_port, ordinal, workshop_id, name)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for (ordinal, m) in mods.iter().enumerate() {
            stmt.execute(params![
                ip,
                key.query_port,
                ordinal as i64,
                m.workshop_id as i64,
                m.name
            ])?;
        }
    }
    tx.execute(
        "UPDATE servers SET mod_count = ?3 WHERE ip = ?1 AND query_port = ?2",
        params![ip, key.query_port, mods.len() as i64],
    )?;
    tx.commit()?;
    Ok(())
}

fn set_favourite(
    conn: &Connection,
    key: ServerKey,
    favourite: bool,
) -> Result<usize, RegistryError> {
    let n = conn.execute(
        "UPDATE servers SET favourite = ?3 WHERE ip = ?1 AND query_port = ?2",
        params![key.ip.to_string(), key.query_port, favourite],
    )?;
    Ok(n)
}

fn mark_played(conn: &Connection, key: ServerKey) -> Result<usize, RegistryError> {
    let n = conn.execute(
        "UPDATE servers SET last_played = unixepoch() WHERE ip = ?1 AND query_port = ?2",
        params![key.ip.to_string(), key.query_port],
    )?;
    Ok(n)
}

fn set_online(conn: &Connection, keys: &[ServerKey], online: bool) -> Result<(), RegistryError> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt =
            tx.prepare_cached("UPDATE servers SET online = ?3 WHERE ip = ?1 AND query_port = ?2")?;
        for key in keys {
            stmt.execute(params![key.ip.to_string(), key.query_port, online])?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
