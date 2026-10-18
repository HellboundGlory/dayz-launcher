use crate::error::RegistryError;
use rusqlite::Connection;

pub const LATEST_VERSION: u32 = 7;

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
    Migration {
        version: 4,
        sql: V4,
    },
    Migration {
        version: 5,
        sql: V5,
    },
    Migration {
        version: 6,
        sql: V6,
    },
    Migration {
        version: 7,
        sql: V7,
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

/// `online` is written by a targeted A2S refresh and by the index pull, which carries the backend's
/// verdict; the upsert guard never touches it. Defaults to `1` — a server only ever discovered
/// through Steam hasn't been shown to be down.
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

/// When Tetra last sent this server an A2S_INFO of its own, whether or not it
/// answered. Only the unresolved sweep reads it, to rotate fairly through rows
/// Steam listed but never resolved — without it, the same permanently dead
/// addresses fill the window every pass and newly listed ones never get asked.
const V4: &str = r#"
ALTER TABLE servers ADD COLUMN last_probe_attempt INTEGER;
"#;

// Spoofed listings collected before `is_fake_listing` existed. The numeric
// half of that predicate is expressible in SQL; control-character names are
// left to the write path, which deletes them on the next sighting.
const V5: &str = r#"
DELETE FROM server_mods WHERE (ip, query_port) IN (
    SELECT ip, query_port FROM servers
    WHERE bots > 0
       OR players >= 255
       OR max_players >= 255
       OR (max_players > 0 AND players > max_players)
);
DELETE FROM servers
WHERE bots > 0
   OR players >= 255
   OR max_players >= 255
   OR (max_players > 0 AND players > max_players);
"#;

/// When a server's mod list was last read from A2S_RULES, so a rules sweep can
/// rotate oldest-first instead of re-asking servers it just asked. The
/// `last_seen` index serves the newest-first address walk.
const V6: &str = r#"
ALTER TABLE servers ADD COLUMN mods_updated_at INTEGER;
CREATE INDEX idx_servers_last_seen ON servers(last_seen);
"#;

const V7: &str = r#"
CREATE TABLE workshop_cache (
    workshop_id   INTEGER NOT NULL PRIMARY KEY,
    title         TEXT    NOT NULL,
    file_size     INTEGER NOT NULL,
    preview_url   TEXT,
    time_updated  INTEGER NOT NULL,
    cached_at     INTEGER NOT NULL
);
"#;

/// How long a server may go unresponsive, in days, before it's pruned —
/// unless the user has favourited or played it. See [`prune_stale`].
pub const PRUNE_AFTER_DAYS: i64 = 60;

/// Delete servers unresponsive past [`PRUNE_AFTER_DAYS`] with no favourite/play history, plus
/// their mod rows. Only `VACUUM`s if something was actually deleted.
pub fn prune_stale(conn: &Connection) -> Result<usize, RegistryError> {
    // A row that has *never* answered is pruned on `last_seen` instead: it has
    // no `last_responded` to age out on, so the old predicate kept every one of
    // them forever — thousands of nameless, unlistable rows that the browser
    // hides and nothing ever deleted.
    const CUTOFF_PREDICATE: &str = "COALESCE(last_responded, last_seen) < unixepoch() - ?1 \
         AND favourite = 0 \
         AND last_played IS NULL";
    let cutoff_secs = PRUNE_AFTER_DAYS * 86_400;

    let tx = conn.unchecked_transaction()?;
    let deleted = tx.execute(
        &format!("DELETE FROM servers WHERE {CUTOFF_PREDICATE}"),
        [cutoff_secs],
    )?;
    if deleted > 0 {
        // Mods whose server row is gone, including the ones just pruned; nothing else removes them.
        tx.execute(
            "DELETE FROM server_mods WHERE NOT EXISTS \
             (SELECT 1 FROM servers s WHERE s.ip = server_mods.ip AND s.query_port = server_mods.query_port)",
            [],
        )?;
    }
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

    /// `responded_age_days` is `None` for a row Steam listed but that never
    /// answered anyone, which then ages out on `last_seen` instead.
    fn insert_server(
        conn: &Connection,
        last_seen_age_days: i64,
        responded_age_days: Option<i64>,
        favourite: bool,
        played_age_days: Option<i64>,
    ) {
        let seen = now() - last_seen_age_days * 86_400;
        conn.execute(
            "INSERT INTO servers (ip, query_port, first_seen, last_seen, last_responded, favourite, last_played)
             VALUES ('1.2.3.4', 2302, ?1, ?1, ?2, ?3, ?4)",
            rusqlite::params![
                seen,
                responded_age_days.map(|d| now() - d * 86_400),
                favourite as i64,
                played_age_days.map(|d| now() - d * 86_400),
            ],
        )
        .unwrap();
    }

    struct PruneCase {
        name: &'static str,
        last_seen_age_days: i64,
        responded_age_days: Option<i64>,
        favourite: bool,
        played_age_days: Option<i64>,
        expected_pruned: usize,
    }

    #[test]
    fn prune_stale_keeps_servers_that_are_recent_cared_about_or_still_listed() {
        let cases = [
            PruneCase {
                name: "recently responsive",
                last_seen_age_days: 0,
                responded_age_days: Some(10),
                favourite: false,
                played_age_days: None,
                expected_pruned: 0,
            },
            PruneCase {
                name: "unresponsive and uncared for",
                last_seen_age_days: 0,
                responded_age_days: Some(61),
                favourite: false,
                played_age_days: None,
                expected_pruned: 1,
            },
            PruneCase {
                name: "favourited however stale",
                last_seen_age_days: 0,
                responded_age_days: Some(400),
                favourite: true,
                played_age_days: None,
                expected_pruned: 0,
            },
            PruneCase {
                name: "played however stale",
                last_seen_age_days: 0,
                responded_age_days: Some(400),
                favourite: false,
                played_age_days: Some(400),
                expected_pruned: 0,
            },
            PruneCase {
                name: "never responded, still listed",
                last_seen_age_days: 1,
                responded_age_days: None,
                favourite: false,
                played_age_days: None,
                expected_pruned: 0,
            },
            PruneCase {
                name: "never responded, aged out",
                last_seen_age_days: 61,
                responded_age_days: None,
                favourite: false,
                played_age_days: None,
                expected_pruned: 1,
            },
        ];
        for case in cases {
            let conn = fresh_conn();
            insert_server(
                &conn,
                case.last_seen_age_days,
                case.responded_age_days,
                case.favourite,
                case.played_age_days,
            );
            assert_eq!(
                prune_stale(&conn).unwrap(),
                case.expected_pruned,
                "case: {}",
                case.name
            );
        }
    }

    #[test]
    fn prune_stale_sweeps_mods_of_removed_and_orphaned_servers() {
        // `server_mods` has no `FOREIGN KEY` on (ip, query_port) — nothing
        // cascades this for free.
        let conn = fresh_conn();
        conn.execute(
            "INSERT INTO server_mods (ip, query_port, ordinal, workshop_id, name)
             VALUES ('9.9.9.9', 2302, 0, 1559212036, 'Orphan')",
            [],
        )
        .unwrap();
        insert_server(&conn, 0, Some(61), false, None);
        conn.execute(
            "INSERT INTO server_mods (ip, query_port, ordinal, workshop_id, name)
             VALUES ('1.2.3.4', 2302, 0, 12345, 'Test Mod')",
            [],
        )
        .unwrap();

        assert_eq!(prune_stale(&conn).unwrap(), 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM server_mods", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn prune_stale_leaves_orphaned_mods_when_it_deletes_no_server() {
        let conn = fresh_conn();
        conn.execute(
            "INSERT INTO server_mods (ip, query_port, ordinal, workshop_id, name)
             VALUES ('9.9.9.9', 2302, 0, 1559212036, 'Orphan')",
            [],
        )
        .unwrap();
        insert_server(&conn, 0, Some(10), false, None);
        assert_eq!(prune_stale(&conn).unwrap(), 0);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM server_mods", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}
