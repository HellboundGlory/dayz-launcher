use crate::error::RegistryError;
use rusqlite::Connection;

pub const LATEST_VERSION: u32 = 3;

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: V1,
    },
    Migration {
        version: 2,
        sql: V2,
    },
    Migration {
        version: 3,
        sql: V3,
    },
];

/// Connection-level settings applied to every connection — WAL lets readers run while the
/// writer thread is mid-transaction.
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

-- Unused: workshop metadata is cached in mods-cache.json instead (see
-- commands::mods). Kept rather than dropped — no migration needed for a
-- table that's never held real data.
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

/// `online` is written only by a targeted A2S refresh, never the upsert guard. Defaults to `1` —
/// a server only ever discovered through Steam hasn't been shown to be down.
const V2: &str = r#"
ALTER TABLE servers ADD COLUMN online INTEGER NOT NULL DEFAULT 1;
"#;

/// Server browser extras from the A2S_INFO `keywords` string: queue backlog and day/night
/// multipliers — nullable, only written by a probe that carried the keyword.
const V3: &str = r#"
ALTER TABLE servers ADD COLUMN queue INTEGER;
ALTER TABLE servers ADD COLUMN day_multiplier REAL;
ALTER TABLE servers ADD COLUMN night_multiplier REAL;
"#;

/// How long a server may go unresponsive, in days, before it's pruned —
/// unless the user has favourited or played it. See [`prune_stale`].
const PRUNE_AFTER_DAYS: i64 = 60;

/// Delete servers unresponsive past [`PRUNE_AFTER_DAYS`] with no favourite/play history, plus
/// their mod rows. Only `VACUUM`s if something was actually deleted.
pub fn prune_stale(conn: &Connection) -> Result<usize, RegistryError> {
    const CUTOFF_PREDICATE: &str = "last_responded IS NOT NULL \
         AND last_responded < unixepoch() - ?1 \
         AND favourite = 0 \
         AND last_played IS NULL";
    let cutoff_secs = PRUNE_AFTER_DAYS * 86_400;

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        &format!(
            "DELETE FROM server_mods WHERE (ip, query_port) IN \
             (SELECT ip, query_port FROM servers WHERE {CUTOFF_PREDICATE})"
        ),
        [cutoff_secs],
    )?;
    let deleted = tx.execute(
        &format!("DELETE FROM servers WHERE {CUTOFF_PREDICATE}"),
        [cutoff_secs],
    )?;
    tx.commit()?;

    if deleted > 0 {
        conn.execute("VACUUM", [])?;
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn now() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    }

    fn insert_server(
        conn: &Connection,
        ip: &str,
        port: i64,
        last_responded: Option<i64>,
        favourite: bool,
        last_played: Option<i64>,
    ) {
        conn.execute(
            "INSERT INTO servers (ip, query_port, first_seen, last_seen, last_responded, favourite, last_played)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6)",
            rusqlite::params![ip, port, now(), last_responded, favourite as i64, last_played],
        )
        .unwrap();
    }

    #[test]
    fn a_long_unresponsive_unfavourited_unplayed_server_is_pruned() {
        let conn = fresh_conn();
        insert_server(
            &conn,
            "1.2.3.4",
            2302,
            Some(now() - 61 * 86_400),
            false,
            None,
        );
        assert_eq!(prune_stale(&conn).unwrap(), 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM servers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn a_recently_responsive_server_survives() {
        let conn = fresh_conn();
        insert_server(
            &conn,
            "1.2.3.4",
            2302,
            Some(now() - 10 * 86_400),
            false,
            None,
        );
        assert_eq!(prune_stale(&conn).unwrap(), 0);
    }

    #[test]
    fn a_favourite_survives_no_matter_how_stale() {
        let conn = fresh_conn();
        insert_server(
            &conn,
            "1.2.3.4",
            2302,
            Some(now() - 400 * 86_400),
            true,
            None,
        );
        assert_eq!(prune_stale(&conn).unwrap(), 0);
    }

    #[test]
    fn a_played_server_survives_no_matter_how_stale() {
        let conn = fresh_conn();
        insert_server(
            &conn,
            "1.2.3.4",
            2302,
            Some(now() - 400 * 86_400),
            false,
            Some(now() - 400 * 86_400),
        );
        assert_eq!(prune_stale(&conn).unwrap(), 0);
    }

    #[test]
    fn a_never_responded_server_is_left_alone() {
        // `last_responded IS NULL` means "discovered but never A2S-probed",
        // not "confirmed dead" — pruning on a guess like that is
        // deliberately out of this policy's scope.
        let conn = fresh_conn();
        insert_server(&conn, "1.2.3.4", 2302, None, false, None);
        assert_eq!(prune_stale(&conn).unwrap(), 0);
    }

    #[test]
    fn pruning_a_server_also_deletes_its_declared_mods() {
        // `server_mods` has no `FOREIGN KEY` on (ip, query_port) — nothing
        // cascades this for free.
        let conn = fresh_conn();
        insert_server(
            &conn,
            "1.2.3.4",
            2302,
            Some(now() - 61 * 86_400),
            false,
            None,
        );
        conn.execute(
            "INSERT INTO server_mods (ip, query_port, ordinal, workshop_id, name) \
             VALUES ('1.2.3.4', 2302, 0, 12345, 'Test Mod')",
            [],
        )
        .unwrap();

        prune_stale(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM server_mods", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
