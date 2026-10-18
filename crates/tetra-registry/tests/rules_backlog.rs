//! The rules sweep's queue: a server that never answers A2S_RULES must not
//! keep the front of the backlog on every pass.

mod common;

use common::key;
use tetra_core::unix_now;
use tetra_registry::{Registry, ServerKey, ServerRow};

const TTL: i64 = 21_600;
const RETRY: i64 = 1_800;

fn answered_row(key: ServerKey, players: i32) -> ServerRow {
    ServerRow {
        key,
        name: "Survivor Haven".into(),
        players,
        max_players: 60,
        responded: true,
        ..ServerRow::default()
    }
}

fn queued(rows: Vec<(ServerKey, u16)>) -> Vec<ServerKey> {
    rows.into_iter().map(|(key, _)| key).collect()
}

#[tokio::test]
async fn an_unanswered_server_steps_back_so_the_rest_of_the_backlog_is_reached() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer
        .upsert_servers(vec![
            answered_row(key(10), 5),
            answered_row(key(11), 4),
            answered_row(key(12), 3),
            answered_row(key(13), 0),
            answered_row(key(14), 1),
        ])
        .await
        .expect("write");
    // A mod read just now: its stamp is newer than any retry stamp.
    writer
        .upsert_server_mods(key(14), Vec::new())
        .await
        .expect("mods");

    let reader = registry.reader().expect("reader");
    let first = queued(reader.rules_backlog(2, TTL).expect("backlog"));
    assert_eq!(first, vec![key(10), key(11)]);

    writer
        .mark_rules_unanswered(first, unix_now() - TTL + RETRY)
        .await
        .expect("mark");

    let second = queued(reader.rules_backlog(2, TTL).expect("backlog"));
    assert_eq!(
        second,
        vec![key(12), key(13)],
        "the silent servers step back, so the never-asked one is reached"
    );

    writer
        .mark_rules_unanswered(vec![key(14)], unix_now() - TTL + RETRY)
        .await
        .expect("mark");
    assert!(
        !queued(reader.rules_backlog(10, RETRY).expect("backlog")).contains(&key(14)),
        "a retry stamp never moves a newer read backwards"
    );
}
