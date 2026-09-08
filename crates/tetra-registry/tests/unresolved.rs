//! The unresolved sweep's queue: which rows it hands out, and in what order.
//!
//! A row Steam listed but could not reach is stored with no name, and the
//! browser hides nameless rows. Nothing else ever queries them — the REFRESH
//! button only re-probes rows the frontend loaded, which excludes hidden ones —
//! so discovery asks them itself, oldest attempt first.

use std::net::Ipv4Addr;
use tetra_registry::{Registry, ServerKey, ServerRow};

/// Long enough that nothing in these tests ages past it on its own.
const RETRY_AFTER: i64 = 3600;

fn key(last_octet: u8, port: u16) -> ServerKey {
    ServerKey {
        ip: Ipv4Addr::new(203, 0, 113, last_octet),
        query_port: port,
    }
}

/// A row as Steam's `failed` callback produces it: an address and nothing else.
fn unreachable_row(key: ServerKey) -> ServerRow {
    ServerRow {
        key,
        game_port: 0,
        name: String::new(),
        map: String::new(),
        players: 0,
        max_players: 0,
        bots: 0,
        ping_ms: 0,
        locked: false,
        vac: false,
        version: None,
        keywords: None,
        description: None,
        mod_count: None,
        last_played: None,
        responded: false,
        country_code: None,
    }
}

fn answered_row(key: ServerKey) -> ServerRow {
    ServerRow {
        name: "Survivor Haven".into(),
        map: "chernarusplus".into(),
        players: 3,
        max_players: 60,
        responded: true,
        ..unreachable_row(key)
    }
}

#[tokio::test]
async fn only_rows_that_never_answered_are_queued() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer
        .upsert_servers(vec![
            unreachable_row(key(10, 27016)),
            answered_row(key(11, 27016)),
        ])
        .await
        .expect("write");

    let reader = registry.reader().expect("reader");
    let queued = reader.unresolved(10, RETRY_AFTER).expect("unresolved");
    assert_eq!(queued, vec![key(10, 27016)]);
}

#[tokio::test]
async fn a_row_that_answers_leaves_the_queue() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer
        .upsert_servers(vec![unreachable_row(key(10, 27016))])
        .await
        .expect("write");
    // What the sweep's own A2S_INFO probe writes back on a hit.
    writer
        .upsert_servers(vec![answered_row(key(10, 27016))])
        .await
        .expect("probe result");

    let reader = registry.reader().expect("reader");
    assert!(reader
        .unresolved(10, RETRY_AFTER)
        .expect("unresolved")
        .is_empty());
}

#[tokio::test]
async fn a_dead_address_rotates_to_the_back_once_asked() {
    // Without this, the same permanently dead addresses fill the window on
    // every pass and a newly listed row is never asked at all.
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    let dead = key(10, 27016);
    let fresh = key(11, 27016);
    writer
        .upsert_servers(vec![unreachable_row(dead), unreachable_row(fresh)])
        .await
        .expect("write");

    let reader = registry.reader().expect("reader");
    let first_window = reader.unresolved(1, RETRY_AFTER).expect("unresolved");
    assert_eq!(first_window.len(), 1);
    let asked = first_window[0];

    writer
        .mark_probe_attempt(vec![asked])
        .await
        .expect("mark attempt");

    let second_window = reader.unresolved(1, RETRY_AFTER).expect("unresolved");
    assert_eq!(
        second_window,
        vec![if asked == dead { fresh } else { dead }],
        "an asked-but-silent address must not be handed out again \
         while another row has never been asked"
    );
}

#[tokio::test]
async fn a_recently_asked_row_is_not_asked_again() {
    // The whole backlog being one dead address must not mean re-probing it on
    // every pass — DZSALauncher's per-server staleness throttle, adapted.
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    writer
        .upsert_servers(vec![unreachable_row(key(10, 27016))])
        .await
        .expect("write");
    writer
        .mark_probe_attempt(vec![key(10, 27016)])
        .await
        .expect("mark attempt");

    let reader = registry.reader().expect("reader");
    assert!(
        reader
            .unresolved(10, RETRY_AFTER)
            .expect("unresolved")
            .is_empty(),
        "asked a minute ago, so not due again yet"
    );
    assert_eq!(
        reader.unresolved(10, 0).expect("unresolved"),
        vec![key(10, 27016)],
        "with no throttle it is due immediately"
    );
}

#[tokio::test]
async fn the_window_bounds_how_many_are_handed_out() {
    let registry = Registry::open_in_memory().expect("registry");
    let writer = registry.writer();

    let rows: Vec<ServerRow> = (0..5)
        .map(|i| unreachable_row(key(10, 27016 + i)))
        .collect();
    writer.upsert_servers(rows).await.expect("write");

    let reader = registry.reader().expect("reader");
    assert_eq!(
        reader.unresolved(3, RETRY_AFTER).expect("unresolved").len(),
        3
    );
}
