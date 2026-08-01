use crate::error::RegistryError;
use rusqlite::Connection;

pub const LATEST_VERSION: u32 = 2;

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, sql: V1 },
    Migration { version: 2, sql: V2 },
];

/// Connection-level settings. Applied to every connection, reader or writer.
///
/// WAL lets readers run while the writer thread is mid-transaction, which is
/// the whole point of having one writer rather than a lock around all access.
pub fn apply_pragmas(conn: &Connection) -> Result<(), RegistryError> {
    let _mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

/// Bring a database up to `LATEST_VERSION`. Forward-only.
pub fn migrate(conn: &Connection) -> Result<u32, RegistryError> {
    let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if current > LATEST_VERSION {
        return Err(RegistryError::Migration(format!(
            "database is at version {current}, this build understands {LATEST_VERSION}; \
             it was written by a newer TetraLauncher"
        )));
    }

    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(m.sql)?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
    }

    Ok(LATEST_VERSION)
}

const V1: &str = r#"
CREATE TABLE servers (
    ip              TEXT    NOT NULL,
    query_port      INTEGER NOT NULL,
    game_port       INTEGER NOT NULL DEFAULT 0,
    name            TEXT    NOT NULL DEFAULT '',
    map_raw         TEXT    NOT NULL DEFAULT '',
    map_normalised  TEXT    NOT NULL DEFAULT '',
    players         INTEGER NOT NULL DEFAULT 0,
    max_players     INTEGER NOT NULL DEFAULT 0,
    bots            INTEGER NOT NULL DEFAULT 0,
    ping_ms         INTEGER NOT NULL DEFAULT 0,
    locked          INTEGER NOT NULL DEFAULT 0,
    vac             INTEGER NOT NULL DEFAULT 0,
    version         TEXT,
    keywords        TEXT,
    description     TEXT,
    in_game_time    TEXT,
    mod_count       INTEGER,
    country_code    TEXT,
    official        INTEGER NOT NULL DEFAULT 0,
    first_person    INTEGER NOT NULL DEFAULT 0,
    modded          INTEGER NOT NULL DEFAULT 0,
    battleye        INTEGER NOT NULL DEFAULT 0,
    first_seen      INTEGER NOT NULL,
    last_seen       INTEGER NOT NULL,
    last_responded  INTEGER,
    last_played     INTEGER,
    favourite       INTEGER NOT NULL DEFAULT 0,
    user_tags       TEXT,
    PRIMARY KEY (ip, query_port)
) STRICT;

-- `ordinal` is the server's declared mod order. DayZ is order-sensitive and a
-- reordered -mod= list surfaces to the player as an unexplained kick, so this
-- column is load-bearing and part of the primary key.
CREATE TABLE server_mods (
    ip          TEXT    NOT NULL,
    query_port  INTEGER NOT NULL,
    ordinal     INTEGER NOT NULL,
    workshop_id INTEGER NOT NULL,
    name        TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (ip, query_port, ordinal)
) STRICT;

CREATE TABLE mods (
    workshop_id   INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL DEFAULT '',
    install_state INTEGER,
    size_on_disk  INTEGER,
    install_path  TEXT,
    last_checked  INTEGER
) STRICT;

CREATE INDEX idx_servers_players     ON servers(players);
CREATE INDEX idx_servers_ping        ON servers(ping_ms);
CREATE INDEX idx_servers_mod_count   ON servers(mod_count);
CREATE INDEX idx_servers_map         ON servers(map_normalised);
CREATE INDEX idx_servers_country     ON servers(country_code);
CREATE INDEX idx_servers_last_played ON servers(last_played);
CREATE INDEX idx_server_mods_workshop ON server_mods(workshop_id);
"#;

/// `online` is written only by a targeted A2S refresh (see
/// `commands::server::refresh_visible_servers` / `Writer::set_online`), never
/// by the upsert guard in `writer.rs` — that guard already ignores rows that
/// didn't respond, so it has no signal to flip this from. Defaults to `1`:
/// a server the launcher has only ever discovered through Steam, and never
/// itself failed to reach, has not been shown to be down.
const V2: &str = r#"
ALTER TABLE servers ADD COLUMN online INTEGER NOT NULL DEFAULT 1;
"#;